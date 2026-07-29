"""Campaign pipeline runner.

Executed by the queue worker (queue_worker.py). Structure per campaign:

1. Parse JD + resume files (PDF/DOCX/TXT) into text.
2. Dedup candidates by email/phone across the whole campaign.
3. Stage 1 ONCE: RequirementsCrew merges JD + recruiter requirements into a
   Unified Requirements Profile.
4. Chunked screening: ScreeningCrew (parse -> evaluate -> outreach) per chunk,
   with dynamic hard-filter/scoring/flag rules built from the campaign's
   RequirementsProfile. Per-chunk retry; one failed chunk never kills the run.
5. Results mapped back by Candidate ID (order-based fallback), token usage
   aggregated, outputs archived under outputs/campaign_<id>/.
"""

import hashlib
import json
import os
import re
import shutil
import time
import traceback

from ..crew import OutreachCrew, RequirementsCrew, ScreeningCrew
from ..db.database import SessionLocal
from ..db.models import Campaign, Candidate, Company, UnifiedRequirements, utcnow
from ..schemas.requirements import RequirementsProfileV1
from .scoring import compute_score, judgment_record
from ..utils.parser import (
    extract_text_from_docx,
    extract_text_from_pdf,
    format_resumes_for_crewai,
)
from .prompt_builder import (
    build_extra_rules,
    build_hard_filter_rules,
    build_outreach_context,
    build_recruiter_requirements_block,
    build_scoring_rules,
    load_profile,
    render_unified_requirements,
)

# 1 = each candidate evaluated in isolation: batch-mates influenced scoring
# (correlated drift within chunks observed in A/B runs 17 vs 18)
BATCH_SIZE = 1
CHUNK_SLEEP_SECONDS = 10
CHUNK_RETRIES = 1

# Uploads live under the package dir (same convention as app.py's BASE_DIR)
UPLOADS_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads"
)


def _campaign_paths(campaign_id: int) -> tuple[str | None, str | None]:
    """(upload_dir, jd_path) for a campaign, if the uploads still exist."""
    upload_dir = os.path.join(UPLOADS_ROOT, f"campaign_{campaign_id}")
    if not os.path.isdir(upload_dir):
        return None, None
    jd_path = next(
        (
            os.path.join(upload_dir, f)
            for f in sorted(os.listdir(upload_dir))
            if f.startswith("JD_")
        ),
        None,
    )
    return upload_dir, jd_path

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+?\d[\d\s()-]{8,}\d)")


def _extract_file_text(path: str) -> str:
    if path.endswith(".pdf"):
        with open(path, "rb") as f:
            return extract_text_from_pdf(f.read())
    if path.endswith(".docx"):
        with open(path, "rb") as f:
            return extract_text_from_docx(f.read())
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def _contact_keys(text: str) -> set[str]:
    keys = {m.lower() for m in EMAIL_RE.findall(text or "")}
    for m in PHONE_RE.findall(text or ""):
        digits = re.sub(r"\D", "", m)
        if len(digits) >= 10:
            keys.add(digits[-10:])  # last 10 digits normalizes country codes
    return keys


def rubric_key(jd_text: str, profile: RequirementsProfileV1 | None) -> str:
    """Identical (JD, requirements) inputs -> identical key, so campaigns can
    share a Stage 1 rubric and score against a byte-identical checklist.
    The profile is canonicalized through the schema (fixed field order;
    unknown/legacy keys already dropped by validation)."""
    canonical = profile.model_dump_json() if profile else ""
    payload = (jd_text or "").strip() + "\x00" + canonical
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _partition_candidates(candidates: list[Candidate]) -> list[Candidate]:
    """Contact-dedup across ALL candidates; return only unscreened ones.

    Screened = has a score or any recommendation (incl. "Duplicate").
    Screened candidates still register their contact keys so a new resume
    duplicating an old candidate is caught.
    """
    seen: dict[str, int] = {}
    to_process: list[Candidate] = []
    for candidate in candidates:
        screened = candidate.score is not None or bool(candidate.recommendation)
        keys = _contact_keys(candidate.parsed_text)
        dup_of = next((seen[k] for k in keys if k in seen), None)
        if dup_of is not None and not screened:
            candidate.recommendation = "Duplicate"
            candidate.rationale = (
                f"Duplicate resume — same contact details as candidate #{dup_of}."
            )
            candidate.score = None
            continue
        for k in keys:
            seen.setdefault(k, candidate.id)
        if not screened:
            to_process.append(candidate)
    return to_process


def _final_recommendation(ev, threshold: float, maybe_band: int) -> tuple[int, str]:
    """Boundary math is code, not LLM output. The model supplies the score and
    evidence; the Shortlist/Maybe/Reject verdict is recomputed deterministically."""
    if ev.hard_filter_failed:
        return 0, "Reject (Hard Filter)"
    score = max(0, min(100, ev.score))
    if score >= threshold:
        return score, "Shortlist"
    if score >= threshold - maybe_band:
        return score, "Maybe"
    return score, "Reject"


def _apply_evaluation(
    candidate: Candidate,
    ev,
    threshold: float,
    maybe_band: int,
    record: dict | None = None,
) -> None:
    score, recommendation = _final_recommendation(ev, threshold, maybe_band)
    candidate.judgments = record
    candidate.name = ev.name
    candidate.score = score
    candidate.recommendation = recommendation
    candidate.hard_filter_failed = ev.hard_filter_failed
    candidate.set_strengths(ev.key_strengths)
    candidate.set_gaps(ev.key_gaps)
    candidate.rationale = ev.rationale
    candidate.needs_info = json.dumps(ev.needs_info or [])
    candidate.flags = json.dumps(ev.flags or [])
    candidate.email_draft = ev.email_draft
    candidate.sms_draft = ev.sms_draft


def _shortlisted_block(candidates: list[Candidate]) -> str:
    """Plain-text summary of shortlisted candidates for the outreach prompt."""
    blocks = []
    for c in candidates:
        strengths = ", ".join(c.get_strengths()) or "(none recorded)"
        blocks.append(
            f"Candidate ID: {c.id}\n"
            f"Name: {c.name or '(name not extracted)'}\n"
            f"Key strengths: {strengths}\n"
            f"Evaluation rationale: {c.rationale or '(none)'}"
        )
    return "\n\n".join(blocks)


def _usage_dict(token_usage) -> dict:
    if token_usage is None:
        return {}
    if hasattr(token_usage, "model_dump"):
        return {k: v for k, v in token_usage.model_dump().items() if isinstance(v, (int, float))}
    if isinstance(token_usage, dict):
        return {k: v for k, v in token_usage.items() if isinstance(v, (int, float))}
    return {}


def _add_usage(total: dict, usage: dict) -> None:
    for k, v in usage.items():
        total[k] = total.get(k, 0) + v


def _write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content or "")


def run_campaign(campaign_id: int) -> None:
    upload_dir, jd_path = _campaign_paths(campaign_id)
    db = SessionLocal()
    campaign = None
    try:
        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if not campaign:
            return
        company = (
            db.query(Company).filter(Company.id == campaign.company_id).first()
            if campaign.company_id
            else None
        )
        profile: RequirementsProfileV1 | None = load_profile(campaign)
        region = campaign.region or (company.default_region if company else "IN")
        campaign.error_message = None  # fresh attempt clears the last failure
        db.commit()

        # ---- 1. Parse input files ----
        if jd_path and os.path.exists(jd_path):
            campaign.jd_text = _extract_file_text(jd_path)
            db.commit()

        candidates = (
            db.query(Candidate).filter(Candidate.campaign_id == campaign_id).all()
        )
        if upload_dir and os.path.exists(upload_dir):
            for candidate in candidates:
                if not candidate.parsed_text:
                    file_path = os.path.join(upload_dir, candidate.original_filename)
                    if os.path.exists(file_path):
                        candidate.parsed_text = _extract_file_text(file_path)
            db.commit()

        # ---- 2. Cross-candidate dedup by email/phone; skip already-screened ----
        to_process = _partition_candidates(candidates)
        db.commit()

        output_dir = os.path.join("outputs", f"campaign_{campaign_id}")
        os.makedirs(output_dir, exist_ok=True)
        total_usage: dict = {}
        final_content = ""

        # ---- 3. Stage 1: unified requirements (generated ONCE per campaign
        # family, then stored) ----
        # Retries and "Run again" clones reuse the stored checklist so every
        # run of a campaign scores against a byte-identical rubric; only a
        # campaign with no stored profile generates one.
        unified_profile: UnifiedRequirements | None = None
        if campaign.unified_profile:
            try:
                unified_profile = UnifiedRequirements.model_validate(
                    campaign.unified_profile
                )
            except ValueError:
                unified_profile = None  # stored shape outdated: regenerate
        campaign.rubric_key = rubric_key(campaign.jd_text, profile)
        db.commit()
        if unified_profile is None:
            # Same company + same (JD, requirements) -> reuse the existing
            # rubric so identical inputs score identically across campaigns.
            donor = (
                db.query(Campaign)
                .filter(
                    Campaign.company_id == campaign.company_id,
                    Campaign.rubric_key == campaign.rubric_key,
                    Campaign.unified_profile.isnot(None),
                    Campaign.id != campaign.id,
                )
                .order_by(Campaign.id.desc())
                .first()
            )
            if donor is not None:
                try:
                    unified_profile = UnifiedRequirements.model_validate(
                        donor.unified_profile
                    )
                    campaign.unified_profile = donor.unified_profile
                    db.commit()
                    print(
                        f"[pipeline] campaign {campaign_id} reusing rubric "
                        f"from campaign {donor.id}",
                        flush=True,
                    )
                except ValueError:
                    unified_profile = None  # donor shape outdated: regenerate
        if unified_profile is None:
            recruiter_block = build_recruiter_requirements_block(profile, region)
            stage1 = RequirementsCrew().crew().kickoff(
                inputs={
                    "job_description": campaign.jd_text or "(no job description provided)",
                    "recruiter_requirements": recruiter_block,
                }
            )
            unified_profile = stage1.pydantic or UnifiedRequirements(
                summary=stage1.raw[:2000]
            )
            _add_usage(total_usage, _usage_dict(stage1.token_usage))
            campaign.unified_profile = unified_profile.model_dump()
            db.commit()
        # Structured output rendered to fixed-format text: the rubric Stage 2
        # scores against must not vary in shape or verbosity run-to-run.
        unified_requirements = render_unified_requirements(unified_profile)
        _write(os.path.join(output_dir, "requirements.md"), unified_requirements)
        final_content += (
            f"## Unified Job Requirements\n\n{unified_requirements}\n\n---\n\n"
        )

        # ---- 4. Chunked screening ----
        weights = (profile or RequirementsProfileV1()).effective_weights()
        region_rules = {
            "US": "This is a United States campaign. NEVER extract, record, or consider current or past salary "
            "(salary-history bans apply in many US jurisdictions) — stated future expectations only. "
            "Never record graduation years as an age signal.",
            "UK": "This is a United Kingdom campaign. Never record health or disability information "
            "(Equality Act s.60 prohibits pre-offer health questions).",
            "IN": "This is an India campaign. Compensation is typically discussed as annual CTC. "
            "Never record caste, religion, or marital status even if present on the resume.",
        }.get(region, "(none)")
        base_inputs = {
            "region_rules": region_rules,
            "unified_requirements": unified_requirements,
            "hard_filter_rules": build_hard_filter_rules(profile),
            "scoring_rules": build_scoring_rules(weights),
            "extra_rules": build_extra_rules(profile),
        }

        failed_chunks = 0
        total_chunks = 0
        for i in range(0, len(to_process), BATCH_SIZE):
            chunk = to_process[i : i + BATCH_SIZE]
            chunk_no = i // BATCH_SIZE + 1
            total_chunks += 1
            chunk_dir = os.path.join(output_dir, f"chunk_{chunk_no}")

            result = None
            for attempt in range(CHUNK_RETRIES + 1):
                try:
                    result = ScreeningCrew().crew().kickoff(
                        inputs={**base_inputs, "resumes": format_resumes_for_crewai(chunk)}
                    )
                    break
                except Exception:
                    print(
                        f"[pipeline] campaign {campaign_id} chunk {chunk_no} attempt "
                        f"{attempt + 1} failed:\n{traceback.format_exc()}",
                        flush=True,
                    )
                    if attempt < CHUNK_RETRIES:
                        time.sleep(15)
            if result is None:
                failed_chunks += 1
                for candidate in chunk:
                    candidate.rationale = "Processing failed for this batch — re-run the campaign or evaluate manually."
                db.commit()
                continue

            _add_usage(total_usage, _usage_dict(result.token_usage))

            # Map evaluations back: by Candidate ID, then order-based fallback.
            # Scores are computed in code from the evaluator's binary judgments
            # (scoring.py) — the LLM never does arithmetic.
            maybe_band = profile.maybe_band if profile else 10
            applied: list[Candidate] = []
            if result.pydantic and hasattr(result.pydantic, "evaluations"):
                for ev in result.pydantic.evaluations:
                    ev.score = compute_score(ev, weights, unified_profile)
                chunk_by_id = {c.id: c for c in chunk}
                unmatched = []
                for ev in result.pydantic.evaluations:
                    candidate = chunk_by_id.pop(ev.candidate_id, None)
                    if candidate:
                        _apply_evaluation(
                            candidate,
                            ev,
                            campaign.threshold,
                            maybe_band,
                            record=judgment_record(ev, weights, unified_profile),
                        )
                        applied.append(candidate)
                    else:
                        unmatched.append(ev)
                leftover = sorted(chunk_by_id.values(), key=lambda c: c.id)
                if unmatched and len(unmatched) == len(leftover):
                    unmatched.sort(key=lambda e: e.candidate_id)
                    for candidate, ev in zip(leftover, unmatched):
                        _apply_evaluation(
                            candidate,
                            ev,
                            campaign.threshold,
                            maybe_band,
                            record=judgment_record(ev, weights, unified_profile),
                        )
                        applied.append(candidate)
                elif unmatched:
                    print(
                        f"Warning: {len(unmatched)} evaluation(s) unmatched in campaign {campaign_id} chunk {chunk_no}"
                    )
            db.commit()

            # Outreach drafting only for candidates code shortlisted. A failed
            # outreach call never fails the chunk — drafts just stay empty.
            shortlisted = [c for c in applied if c.recommendation == "Shortlist"]
            outreach_raw = ""
            if shortlisted:
                try:
                    outreach = OutreachCrew().crew().kickoff(
                        inputs={
                            "role_summary": unified_profile.summary,
                            "shortlisted_block": _shortlisted_block(shortlisted),
                            **build_outreach_context(company, campaign),
                        }
                    )
                    _add_usage(total_usage, _usage_dict(outreach.token_usage))
                    outreach_raw = outreach.raw or ""
                    drafts = (
                        {d.candidate_id: d for d in outreach.pydantic.drafts}
                        if outreach.pydantic
                        else {}
                    )
                    for candidate in shortlisted:
                        draft = drafts.get(candidate.id)
                        if draft:
                            candidate.email_draft = draft.email_draft
                            candidate.sms_draft = draft.sms_draft
                    db.commit()
                except Exception:
                    print(
                        f"[pipeline] campaign {campaign_id} chunk {chunk_no} outreach failed:\n"
                        f"{traceback.format_exc()}",
                        flush=True,
                    )

            # Archive stage outputs for this chunk (written directly — no CWD files)
            outputs = list(result.tasks_output or [])
            stage_files = ["parsed.md", "report.md"]
            final_content += f"# Batch {chunk_no}\n\n"
            for task_output, filename in zip(outputs, stage_files):
                _write(os.path.join(chunk_dir, filename), task_output.raw)
                if filename == "report.md":
                    final_content += (
                        f"## Batch {chunk_no} Evaluation Report\n\n{task_output.raw}\n\n---\n\n"
                    )
            if outreach_raw:
                _write(os.path.join(chunk_dir, "outreach.md"), outreach_raw)

            if i + BATCH_SIZE < len(to_process):
                time.sleep(CHUNK_SLEEP_SECONDS)

        # ---- 5. Finalize ----
        if failed_chunks:
            final_content += f"\n\n> Note: {failed_chunks} of {total_chunks} batches failed processing.\n"
        if campaign.final_report and to_process:
            # Incremental run: keep the original report, append the new batch.
            campaign.final_report += (
                f"\n\n---\n\n# Incremental run ({len(to_process)} new candidate(s))\n\n"
                + final_content
            )
        elif to_process or not campaign.final_report:
            campaign.final_report = final_content
        campaign.token_usage = total_usage
        campaign.finished_at = utcnow()
        # Fresh COUNT query — sees candidates the API committed while we ran.
        arrived_mid_run = (
            db.query(Candidate)
            .filter(
                Candidate.campaign_id == campaign_id,
                Candidate.score.is_(None),
                Candidate.recommendation.is_(None),
            )
            .count()
        )
        if total_chunks > 0 and failed_chunks == total_chunks:
            campaign.status = "Error"
        elif arrived_mid_run:
            campaign.status = "Queued"  # back of the line for the newcomers
        else:
            campaign.status = "Completed"
        db.commit()

        if upload_dir and os.path.exists(upload_dir):
            shutil.rmtree(upload_dir, ignore_errors=True)

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[pipeline] campaign {campaign_id} FAILED:\n{tb}", flush=True)
        if campaign:
            campaign.status = "Error"
            campaign.finished_at = utcnow()
            # Short human-readable cause + the failing frame for the UI
            last_frame = next(
                (line.strip() for line in reversed(tb.splitlines()[:-1]) if line.strip()),
                "",
            )
            campaign.error_message = f"{type(e).__name__}: {e}\n{last_frame}"[:2000]
            db.commit()
    finally:
        db.close()
