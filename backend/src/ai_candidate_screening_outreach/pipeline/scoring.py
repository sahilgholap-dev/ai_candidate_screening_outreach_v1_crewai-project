"""Deterministic score computation from the evaluator's binary judgments.

The LLM answers only yes/no ("is React Native on this resume?") and
met/unmet/unknown questions; every point award and all arithmetic happens
here. Unknowns never penalize — same philosophy as the hard-filter
UNKNOWN-never-rejects rule.
"""

import re

from ..db.models import CandidateEvaluation, UnifiedRequirements
from ..schemas.requirements import CustomWeights

_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
_CORE_SUFFIX_RE = re.compile(r"\s*\(core\)\s*$", re.IGNORECASE)

# A core skill (central to the role) weighs this many supporting skills.
CORE_WEIGHT = 3


def _norm(skill: str) -> str:
    return _CORE_SUFFIX_RE.sub("", skill.strip()).lower()


def _parse_min_years(value: str | None) -> float | None:
    """'1', '2+ years', '1.5' -> float; 'Not specified'/None -> None."""
    if not value:
        return None
    m = _NUMBER_RE.search(value)
    return float(m.group()) if m else None


def _fraction_bucket(cap: int, judgments, is_hit) -> int:
    """cap * hits/total, rounded; empty list = nothing to check = full cap."""
    if not judgments:
        return cap
    hits = sum(1 for j in judgments if is_hit(j))
    return round(cap * hits / len(judgments))


def _core_lookup(profile: UnifiedRequirements) -> dict[str, bool]:
    return {_norm(s.skill): s.core for s in profile.required_skills}


def _bucket_points(
    ev: CandidateEvaluation,
    weights: CustomWeights,
    profile: UnifiedRequirements,
) -> dict[str, int]:
    """Per-bucket points for a non-hard-filtered candidate."""
    # Required skills: core skills weigh CORE_WEIGHT× supporting ones, so
    # missing the role's central skill dents the score far more than missing
    # a secondary tool. Judgments are matched to the profile by skill text
    # (tolerant of case and a copied "(core)" marker); unmatched text falls
    # back to supporting weight.
    if ev.required_skill_judgments:
        core = _core_lookup(profile)
        total = hits = 0
        for j in ev.required_skill_judgments:
            w = CORE_WEIGHT if core.get(_norm(j.skill), False) else 1
            total += w
            hits += w if j.present else 0
        required = round(weights.required_skills * hits / total)
    else:
        required = weights.required_skills
    preferred = _fraction_bucket(
        weights.preferred_skills, ev.preferred_skill_judgments, lambda j: j.present
    )
    # 'unknown' counts as met: absence of evidence never deducts points
    must_haves = _fraction_bucket(
        weights.must_haves, ev.must_have_judgments, lambda j: j.status != "unmet"
    )

    # Experience: no stated minimum (or 0) = entry-level, full points for all.
    # From a 1-year minimum upward it differentiates: no duration evidence on
    # the resume counts as 0 years (not free points), scaling proportionally.
    min_years = _parse_min_years(profile.min_years_experience)
    years = ev.estimated_total_years if ev.estimated_total_years is not None else 0.0
    if min_years is None or min_years <= 0 or years >= min_years:
        experience = weights.experience
    else:
        experience = round(weights.experience * years / min_years)

    education_required = profile.education.strip().lower() not in ("", "not specified")
    if education_required and ev.education_status == "unmet":
        education = 0
    else:
        education = weights.education

    return {
        "required_skills": required,
        "must_haves": must_haves,
        "experience": experience,
        "education": education,
        "preferred_skills": preferred,
    }


def compute_score(
    ev: CandidateEvaluation,
    weights: CustomWeights,
    profile: UnifiedRequirements,
) -> int:
    if ev.hard_filter_failed:
        return 0
    total = sum(_bucket_points(ev, weights, profile).values())
    return max(0, min(100, total))


def judgment_record(
    ev: CandidateEvaluation,
    weights: CustomWeights,
    profile: UnifiedRequirements,
) -> dict:
    """The stored tick-sheet: every judgment plus the per-bucket points, so
    the UI can show exactly where a score came from."""
    core = _core_lookup(profile)
    points = _bucket_points(ev, weights, profile)
    caps = {
        "required_skills": weights.required_skills,
        "must_haves": weights.must_haves,
        "experience": weights.experience,
        "education": weights.education,
        "preferred_skills": weights.preferred_skills,
    }
    return {
        "required_skills": [
            {
                "skill": j.skill,
                "present": j.present,
                "core": core.get(_norm(j.skill), False),
            }
            for j in ev.required_skill_judgments
        ],
        "preferred_skills": [
            {"skill": j.skill, "present": j.present}
            for j in ev.preferred_skill_judgments
        ],
        "must_haves": [
            {"item": j.item, "status": j.status} for j in ev.must_have_judgments
        ],
        "estimated_total_years": ev.estimated_total_years,
        "education_status": ev.education_status,
        "breakdown": {
            "buckets": {k: {"points": v, "cap": caps[k]} for k, v in points.items()},
            "total": compute_score(ev, weights, profile),
        },
    }
