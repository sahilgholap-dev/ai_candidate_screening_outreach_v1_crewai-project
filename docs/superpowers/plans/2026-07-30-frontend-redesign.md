# NEXUS Talent Match Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the client UI to match `HR_Agent_Client_UI_Mockup_v1.html` exactly (except Workspace settings), with the minimal backend support (bands, review workflow, send records, cancel, new profile fields) that makes every element real.

**Architecture:** In-place restyle: mockup CSS variables become Tailwind tokens in `globals.css`; the Shell is rebuilt to the mockup's sidebar/topbar; each route is rebuilt against existing + new API endpoints. Backend gains a band helper, a candidate review/send workflow, campaign cancel, and new requirements fields wired into prompts.

**Tech Stack:** FastAPI/SQLAlchemy/Alembic (`uv run …` from `backend/`), Next.js 16 App Router + Tailwind v4 + TanStack Query (`frontend/`), pytest, tsc.

## Global Constraints

- The mockup file `HR_Agent_Client_UI_Mockup_v1.html` is the visual source of truth; copy its structure/classes as JSX+Tailwind faithfully. Never copy: `.designnote` blocks, `.mockup-jumper`, fake data.
- Skip entirely: mockup's Workspace settings layout (page-settings, lines 1620–1653) — we build our own content there.
- Band mapping (single definition, backend): Not a Fit = recommendation in {"Reject","Reject (Hard Filter)","Duplicate","Needs Review"} or hard_filter_failed; Moderate = "Maybe"; Ideal = "Shortlist" and score ≥ threshold+15; Good = other "Shortlist".
- "Approve & send" records only (no email): requires review_status="approved", blocks bodies matching `\[[^\]]+\]`.
- UI copy says "search", API keeps "campaign" paths. UK-neutral copy from the mockup, but company name comes from real data.
- Backend commands: `uv run pytest -q`, `uv run alembic …` from `backend/`. Frontend: `npx tsc --noEmit`, `npm run lint`, `npm run build` from `frontend/`.
- Frontend is Next 16 — check `frontend/node_modules/next/dist/docs/` when APIs surprise you (per `frontend/AGENTS.md`).
- Commit after every task; end-to-end verification is Task 14.

---

### Task 1: Candidate review/send columns (migration)

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/db/models.py` (Candidate, ~line 246)
- Create: alembic revision `candidate review workflow`

**Interfaces:**
- Produces: `Candidate.review_status: str` ("pending"|"approved"|"rejected"|"later", default "pending"), `Candidate.sent_at: DateTime|None`, `Candidate.sent_by: str|None`, `Candidate.sent_email: Text|None`, `Candidate.sent_sms: Text|None`. `outreach_approved` is REMOVED.

- [ ] **Step 1: Models** — in Candidate replace `outreach_approved = Column(Boolean, default=False, nullable=False)` with:

```python
    # Review workflow: pending -> approved | rejected | later; approved
    # candidates enter the outreach queue until sent_at is stamped.
    review_status = Column(String, default="pending", nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    sent_by = Column(String, nullable=True)  # reviewer email, denormalized
    sent_email = Column(Text, nullable=True)  # final body as approved
    sent_sms = Column(Text, nullable=True)
```

- [ ] **Step 2: Migration** — `uv run alembic revision -m "candidate review workflow"`, then:

```python
def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(
            sa.Column("review_status", sa.String(), nullable=False, server_default="pending")
        )
        batch_op.add_column(sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("sent_by", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("sent_email", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("sent_sms", sa.Text(), nullable=True))
    op.execute(
        "UPDATE candidates SET review_status = 'approved' WHERE outreach_approved"
    )
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_column("outreach_approved")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(
            sa.Column("outreach_approved", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.execute(
        "UPDATE candidates SET outreach_approved = TRUE WHERE review_status = 'approved'"
    )
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_column("sent_sms")
        batch_op.drop_column("sent_email")
        batch_op.drop_column("sent_by")
        batch_op.drop_column("sent_at")
        batch_op.drop_column("review_status")
```

- [ ] **Step 3:** Fix the one `outreach_approved` reference in `app.py` (`CandidateUpdate` + PATCH log block, ~lines 490–525): delete the field from `CandidateUpdate` for now (Task 4 adds `review_status`) and delete the `if "outreach_approved" in changes:` log block.
- [ ] **Step 4:** `uv run alembic upgrade head` then `uv run pytest -q` → all pass.
- [ ] **Step 5:** Commit `feat: candidate review workflow columns (replace outreach_approved)`.

---

### Task 2: Band helper + campaign list counts

**Files:**
- Create: `backend/src/ai_candidate_screening_outreach/bands.py`
- Modify: `backend/src/ai_candidate_screening_outreach/app.py` (`list_campaigns` ~line 126, `view_campaign` ~line 363)
- Test: `backend/tests/test_bands.py`

**Interfaces:**
- Produces: `band_for(recommendation: str|None, score: int|None, hard_filter_failed: bool, threshold: float) -> str` returning "ideal"|"good"|"moderate"|"not_fit"|"unscored".
- `GET /api/campaigns` rows become dicts: `{id, name, status, region, threshold, intake_mode, folder_name, created_at, finished_at, role_title, urgency, counts:{total, processed, recommended, approved, pending_review}}` where recommended = ideal+good, pending_review = recommended with review_status=="pending".
- `view_campaign` candidates gain `"band"` key (serialize via dict, keep all existing ORM fields using a `_candidate_dict(c, threshold)` helper that returns `{**c.__dict__ minus _sa_instance_state, "band": band_for(...)}`).

- [ ] **Step 1: Failing tests** (`backend/tests/test_bands.py`):

```python
"""Band mapping is the front-of-house language for scores."""

from ai_candidate_screening_outreach.bands import band_for


def test_shortlist_far_above_threshold_is_ideal():
    assert band_for("Shortlist", 85, False, 65) == "ideal"


def test_shortlist_at_boundary_is_ideal():
    assert band_for("Shortlist", 80, False, 65) == "ideal"


def test_shortlist_below_boundary_is_good():
    assert band_for("Shortlist", 79, False, 65) == "good"


def test_maybe_is_moderate():
    assert band_for("Maybe", 60, False, 65) == "moderate"


def test_rejects_hard_filter_duplicate_needs_review_are_not_fit():
    for rec in ["Reject", "Reject (Hard Filter)", "Duplicate", "Needs Review"]:
        assert band_for(rec, 10, False, 65) == "not_fit"
    assert band_for("Shortlist", 90, True, 65) == "not_fit"


def test_unscored_is_unscored():
    assert band_for(None, None, False, 65) == "unscored"
```

- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3: Implement** `bands.py`:

```python
"""Fit bands — the client-facing language for screening outcomes.

Numeric scores and thresholds stay agent-internal (drawer only); every list,
count, and export speaks in bands.
"""

IDEAL_MARGIN = 15

NOT_FIT_RECOMMENDATIONS = {"Reject", "Reject (Hard Filter)", "Duplicate", "Needs Review"}


def band_for(
    recommendation: str | None,
    score: int | None,
    hard_filter_failed: bool,
    threshold: float,
) -> str:
    if hard_filter_failed or (recommendation in NOT_FIT_RECOMMENDATIONS):
        return "not_fit"
    if recommendation == "Maybe":
        return "moderate"
    if recommendation == "Shortlist":
        if score is not None and score >= threshold + IDEAL_MARGIN:
            return "ideal"
        return "good"
    if recommendation:  # unknown legacy label — treat as not_fit, never hide
        return "not_fit"
    return "unscored"
```

Then in `app.py`: add `from ai_candidate_screening_outreach.bands import band_for`, a `_candidate_dict(c, threshold)` helper, rewrite `list_campaigns` to build row dicts with counts computed in Python from each campaign's candidates (volumes are small; one `db.query(Candidate).filter(Candidate.campaign_id.in_(ids))` pass grouped in a dict), `role_title`/`urgency` read from `(campaign.requirements or {}).get(...)`, and make `view_campaign` return `_candidate_dict` items.
- [ ] **Step 4:** `uv run pytest -q` → all pass. Add one API test in `test_bands.py`:

```python
def test_campaign_list_has_counts(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("a.txt", b"x"),)).json()["campaign_id"]
    rows = client.get("/api/campaigns", headers=company_auth).json()
    row = next(r for r in rows if r["id"] == cid)
    assert row["counts"]["total"] == 1
    assert row["counts"]["processed"] == 0
    assert "role_title" in row and "urgency" in row
```

- [ ] **Step 5:** Commit `feat: fit bands + campaign list counts`.

---

### Task 3: New requirements fields wired into prompts

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/schemas/requirements.py` (~line 150)
- Modify: `backend/src/ai_candidate_screening_outreach/pipeline/prompt_builder.py` (`build_extra_rules` ~419, `build_outreach_context` ~453, `build_recruiter_requirements_block` ~76)
- Test: `backend/tests/test_new_profile_fields.py`

**Interfaces:**
- Produces on `RequirementsProfileV1`: `role_title: str|None (≤200)`, `urgency: Literal["standard","high","critical"]|None`, `team_context: str|None (≤1000)`, `culture_text: str|None (≤2000)`, `positive_signals: list[str]`, `concern_signals: list[str]`.

- [ ] **Step 1: Failing tests:**

```python
"""New client-form fields flow into the prompts."""

from ai_candidate_screening_outreach.pipeline.prompt_builder import (
    build_extra_rules,
    build_recruiter_requirements_block,
)
from ai_candidate_screening_outreach.schemas.requirements import RequirementsProfileV1


def _profile(**kw):
    return RequirementsProfileV1.model_validate({"version": 1, **kw})


def test_fields_validate_and_default():
    p = _profile(role_title="Data Engineer", urgency="high",
                 culture_text="Detail-oriented.", positive_signals=["Owned a system"],
                 concern_signals=["Job hops"], team_context="6 engineers")
    assert p.urgency == "high" and p.positive_signals == ["Owned a system"]
    assert _profile().positive_signals == []


def test_culture_signals_reach_extra_rules():
    rules = build_extra_rules(_profile(
        culture_text="Owns things end-to-end.",
        positive_signals=["Owned a system end-to-end"],
        concern_signals=["Frequent job hops"],
    ))
    assert "Owned a system end-to-end" in rules
    assert "Frequent job hops" in rules
    assert "culture_match" in rules and "culture_concern" in rules


def test_role_title_reaches_stage1_block():
    block = build_recruiter_requirements_block(_profile(role_title="Head of Compliance"), "UK")
    assert "Head of Compliance" in block
```

- [ ] **Step 2:** Run → FAIL (unknown fields have no effect / missing).
- [ ] **Step 3: Implement.** Schema — after `max_shortlist`:

```python
    # ---- 10. Role context & culture (client form v2) ----
    role_title: Optional[str] = Field(default=None, max_length=200)
    urgency: Optional[Literal["standard", "high", "critical"]] = None  # view-only pacing
    team_context: Optional[str] = Field(default=None, max_length=1000)  # outreach color
    culture_text: Optional[str] = Field(default=None, max_length=2000)
    positive_signals: list[str] = []
    concern_signals: list[str] = []
```

`build_recruiter_requirements_block`: where the block is assembled, include `role_title` when set (e.g. `lines.append(f"Role title: {profile.role_title}")` following the function's existing pattern — read it first and match style). `build_extra_rules`: append when any culture field set:

```python
        if profile.culture_text or profile.positive_signals or profile.concern_signals:
            block = ["**Culture & qualitative signals (evidence-grounded, never protected attributes):**"]
            if profile.culture_text:
                block.append(f"- What makes someone thrive here: {profile.culture_text}")
            if profile.positive_signals:
                block.append(
                    "- Signals to look for: " + "; ".join(profile.positive_signals)
                    + ". When the resume clearly evidences one, add 'culture_match' to flags and name the evidence in key_strengths."
                )
            if profile.concern_signals:
                block.append(
                    "- Signals that would concern the client: " + "; ".join(profile.concern_signals)
                    + ". When clearly evidenced, add 'culture_concern' to flags and name it in key_gaps. NEVER reject on these alone."
                )
            block.append("- These signals adjust emphasis only; scores still come from the rubric buckets.")
            rules.append("\n".join(block))
```

`build_outreach_context`: add keys `"team_context": profile-derived or "(not provided)"` and `"culture_text"` — check how the dict is consumed in runner/crew config first (grep `build_outreach_context` usage and the outreach task YAML placeholders; add matching `{team_context}` mention to the outreach task description so the model uses it: "If team context is provided, weave one concrete sentence about the team in: {team_context}"). Note `build_outreach_context(company, campaign)` takes campaign — load profile inside via `load_profile(campaign)`.
- [ ] **Step 4:** `uv run pytest -q` → pass.
- [ ] **Step 5:** Commit `feat: role/culture profile fields wired into screening and outreach prompts`.

---

### Task 4: Review transitions, send record, queue + sent endpoints

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/app.py` (PATCH ~496; new endpoints after it)
- Test: `backend/tests/test_review_workflow.py`

**Interfaces:**
- `CandidateUpdate` gains `review_status: Literal["pending","approved","rejected","later"] | None`.
- `POST /api/campaigns/{id}/candidates/{cid}/send` body `{"email_body": str, "sms_body": str|None}` → 200 `{sent_at}`; 409 if not approved or already sent; 422 if `re.search(r"\[[^\]]+\]", email_body)`.
- `GET /api/outreach/queue` → `[{candidate_id, campaign_id, campaign_name, role_title, band, name, email, email_draft, sms_draft}]` (approved, unsent, company-scoped; admins get 400 like `/api/my/company`). `email` extracted from parsed_text via the runner's `EMAIL_RE` (first match or None).
- `GET /api/outreach/sent` → `[{candidate_id, name, campaign_name, sent_at, sent_by}]` newest first.

- [ ] **Step 1: Failing tests** (uses conftest fixtures; helper creates a campaign then marks its candidate scored):

```python
"""Review workflow: approve -> queue -> send record -> sent list."""

import re

from ai_candidate_screening_outreach.db.database import SessionLocal
from ai_candidate_screening_outreach.db.models import Candidate


def _score_candidate(cid, **extra):
    db = SessionLocal()
    try:
        cand = db.query(Candidate).filter(Candidate.campaign_id == cid).first()
        cand.score = 90
        cand.recommendation = "Shortlist"
        cand.name = "Test Person"
        cand.email_draft = "Hi Test, ..."
        cand.sms_draft = "Hi Test (sms)"
        for k, v in extra.items():
            setattr(cand, k, v)
        db.commit()
        return cand.id
    finally:
        db.close()


def _patch(client, auth, cid, cand_id, **body):
    return client.patch(f"/api/campaigns/{cid}/candidates/{cand_id}", json=body, headers=auth)


def test_approve_puts_candidate_in_queue(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q1.txt", b"email: q1@x.com"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    r = _patch(client, company_auth, cid, cand_id, review_status="approved")
    assert r.status_code == 200
    queue = client.get("/api/outreach/queue", headers=company_auth).json()
    entry = next(e for e in queue if e["candidate_id"] == cand_id)
    assert entry["band"] == "ideal" and entry["email"] == "q1@x.com"


def test_invalid_review_status_rejected(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q2.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    assert _patch(client, company_auth, cid, cand_id, review_status="maybe-later").status_code == 422


def test_send_requires_approval(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q3.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    r = client.post(f"/api/campaigns/{cid}/candidates/{cand_id}/send",
                    json={"email_body": "Hello"}, headers=company_auth)
    assert r.status_code == 409


def test_send_blocks_placeholders(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q4.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    _patch(client, company_auth, cid, cand_id, review_status="approved")
    r = client.post(f"/api/campaigns/{cid}/candidates/{cand_id}/send",
                    json={"email_body": "Dear [Candidate], join [Company]"}, headers=company_auth)
    assert r.status_code == 422


def test_send_records_and_moves_to_sent(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q5.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    _patch(client, company_auth, cid, cand_id, review_status="approved")
    r = client.post(f"/api/campaigns/{cid}/candidates/{cand_id}/send",
                    json={"email_body": "Hello there", "sms_body": "hi"}, headers=company_auth)
    assert r.status_code == 200 and r.json()["sent_at"]
    # second send is a conflict
    r2 = client.post(f"/api/campaigns/{cid}/candidates/{cand_id}/send",
                     json={"email_body": "Hello again"}, headers=company_auth)
    assert r2.status_code == 409
    queue = client.get("/api/outreach/queue", headers=company_auth).json()
    assert all(e["candidate_id"] != cand_id for e in queue)
    sent = client.get("/api/outreach/sent", headers=company_auth).json()
    assert any(s["candidate_id"] == cand_id and s["sent_by"] == "user@testco.example" for s in sent)
```

- [ ] **Step 2:** Run → FAIL (fields/routes missing).
- [ ] **Step 3: Implement.** `CandidateUpdate.review_status` (Literal, Pydantic enforces 422). In PATCH, audit-log review changes: `log_action(db, "candidate.review", user=user, detail={"campaign_id":..., "candidate_id":..., "review_status": value})`. New endpoints:

```python
PLACEHOLDER_RE = re.compile(r"\[[^\]]+\]")


class SendBody(BaseModel):
    email_body: str
    sms_body: str | None = None


@app.post("/api/campaigns/{campaign_id}/candidates/{candidate_id}/send")
async def send_outreach(
    campaign_id: int, candidate_id: int, body: SendBody,
    user: User = Depends(require_company_user), db: Session = Depends(get_db),
):
    """Phase-1 'send': records reviewer + final content; no email leaves the system."""
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    candidate = (db.query(Candidate)
                 .filter(Candidate.id == candidate_id, Candidate.campaign_id == campaign.id).first())
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if candidate.review_status != "approved":
        raise HTTPException(status_code=409, detail="Approve the candidate before sending")
    if candidate.sent_at is not None:
        raise HTTPException(status_code=409, detail="Outreach already sent for this candidate")
    if PLACEHOLDER_RE.search(body.email_body or ""):
        raise HTTPException(status_code=422,
                            detail="The draft still contains [placeholder] text — fill it in before sending")
    candidate.sent_at = utcnow()
    candidate.sent_by = user.email
    candidate.sent_email = body.email_body
    candidate.sent_sms = body.sms_body
    log_action(db, "outreach.sent", user=user, company_id=campaign.company_id,
               detail={"campaign_id": campaign.id, "candidate_id": candidate.id,
                       "email_chars": len(body.email_body), "sms": bool(body.sms_body)})
    db.commit()
    return {"sent_at": candidate.sent_at.isoformat()}
```

(import `re`, `utcnow` from models, and the runner's `EMAIL_RE` for the queue). Queue/sent:

```python
@app.get("/api/outreach/queue")
async def outreach_queue(user: User = Depends(require_company_user), db: Session = Depends(get_db)):
    from ai_candidate_screening_outreach.pipeline.runner import EMAIL_RE
    if user.role == "platform_admin":
        raise HTTPException(status_code=400, detail="Admins are not linked to a company")
    rows = (db.query(Candidate, Campaign)
            .join(Campaign, Candidate.campaign_id == Campaign.id)
            .filter(Campaign.company_id == user.company_id,
                    Candidate.review_status == "approved",
                    Candidate.sent_at.is_(None))
            .order_by(Candidate.id.asc()).all())
    out = []
    for cand, camp in rows:
        m = EMAIL_RE.search(cand.parsed_text or "")
        out.append({
            "candidate_id": cand.id, "campaign_id": camp.id, "campaign_name": camp.name,
            "role_title": (camp.requirements or {}).get("role_title"),
            "band": band_for(cand.recommendation, cand.score, bool(cand.hard_filter_failed), camp.threshold or 65.0),
            "name": cand.name or cand.original_filename, "email": m.group(0) if m else None,
            "email_draft": cand.email_draft, "sms_draft": cand.sms_draft,
        })
    return out


@app.get("/api/outreach/sent")
async def outreach_sent(user: User = Depends(require_company_user), db: Session = Depends(get_db)):
    if user.role == "platform_admin":
        raise HTTPException(status_code=400, detail="Admins are not linked to a company")
    rows = (db.query(Candidate, Campaign)
            .join(Campaign, Candidate.campaign_id == Campaign.id)
            .filter(Campaign.company_id == user.company_id, Candidate.sent_at.isnot(None))
            .order_by(Candidate.sent_at.desc()).all())
    return [{"candidate_id": c.id, "name": c.name or c.original_filename,
             "campaign_name": camp.name, "sent_at": c.sent_at, "sent_by": c.sent_by}
            for c, camp in rows]
```

- [ ] **Step 4:** `uv run pytest -q` → pass.
- [ ] **Step 5:** Commit `feat: review transitions, send records, outreach queue/sent endpoints`.

---

### Task 5: Cancel search (endpoint + runner abort)

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/app.py` (new endpoint; `add_resumes` guard)
- Modify: `backend/src/ai_candidate_screening_outreach/pipeline/runner.py` (chunk loop ~line 250; finalize)
- Test: `backend/tests/test_cancel.py`

**Interfaces:**
- `POST /api/campaigns/{id}/cancel`: from status in {Watching, Queued, Processing} → status "Cancelled", audit `campaign.cancelled`; else 409.
- Runner: at the top of each chunk iteration, re-read status from a fresh query; if "Cancelled" or campaign row gone → break; finalize must not overwrite "Cancelled" status and must not self-requeue. `add_resumes` returns 409 for Cancelled campaigns.

- [ ] **Step 1: Failing tests:**

```python
"""Cancel preserves partial results and stops the queue."""

from ai_candidate_screening_outreach.db.database import SessionLocal
from ai_candidate_screening_outreach.db.models import Campaign


def _set_status(cid, status):
    db = SessionLocal()
    try:
        db.query(Campaign).filter(Campaign.id == cid).update({"status": status})
        db.commit()
    finally:
        db.close()


def test_cancel_watching_and_queued(client, company_auth, create_campaign_fn):
    for initial in ("Watching", "Queued"):
        cid = create_campaign_fn(intake_mode="folder", resumes=(), folder_name="F").json()["campaign_id"]
        _set_status(cid, initial)
        r = client.post(f"/api/campaigns/{cid}/cancel", headers=company_auth)
        assert r.status_code == 200 and r.json()["status"] == "Cancelled"


def test_cancel_completed_conflicts(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("c1.txt", b"x"),)).json()["campaign_id"]
    _set_status(cid, "Completed")
    assert client.post(f"/api/campaigns/{cid}/cancel", headers=company_auth).status_code == 409


def test_add_resumes_to_cancelled_conflicts(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("c2.txt", b"x"),)).json()["campaign_id"]
    _set_status(cid, "Cancelled")
    r = client.post(f"/api/campaigns/{cid}/resumes",
                    files=[("resume_files", ("n.txt", b"y", "text/plain"))], headers=company_auth)
    assert r.status_code == 409
```

- [ ] **Step 2:** Run → FAIL. 
- [ ] **Step 3: Implement.** Endpoint mirrors retry's shape; in `add_resumes` add `if campaign.status == "Cancelled": raise HTTPException(409, "This search was cancelled — start a new one to screen more resumes")` before validation. Runner chunk loop start:

```python
            current_status = (
                db.query(Campaign.status).filter(Campaign.id == campaign_id).scalar()
            )
            if current_status is None or current_status == "Cancelled":
                print(f"[pipeline] campaign {campaign_id} cancelled/deleted — stopping", flush=True)
                break
```

Finalize: wrap status assignment in `if campaign.status != "Cancelled":` (re-query status the same way first) and skip the requeue branch when cancelled; still write final_report/token_usage for the partial work.
- [ ] **Step 4:** `uv run pytest -q` → pass.
- [ ] **Step 5:** Commit `feat: cancel search preserves partial results`.

---

### Task 6: Design tokens + Shell + login/reset restyle

**Files:**
- Modify: `frontend/src/app/globals.css` (`:root` values only — keep the `@theme inline` mapping and variable names; add new soft/band tokens)
- Rewrite: `frontend/src/components/shell.tsx`
- Create: `frontend/src/lib/bands.ts`, `frontend/src/components/status-dot.tsx`, `frontend/src/components/filter-chip.tsx`
- Modify: `frontend/src/app/login/page.tsx`, `frontend/src/app/reset-password/page.tsx`

**Interfaces (later tasks consume):**
- Tokens (mockup lines 8–30): `--sidebar:#0A1F1A`, `--sidebar-accent:#143329`, `--primary:#10B981`, primary-hover via `--accent:#059669`? No — keep shadcn slots: `--primary:#10B981`, `--primary-foreground:#fff`, `--background:#F8FAFC`, `--card:#fff`, `--border:#E2E8F0`, `--input:#CBD5E1`, `--foreground:#0F172A`, `--muted-foreground:#64748B`, `--ring:#10B981`, `--radius:10px`; verdict slots: pass `#10B981`/soft `#D1FAE5`, hold `#F59E0B`/soft `#FEF3C7`, fail `#EF4444`/soft `#FEE2E2`; add `--band-blue:#3B82F6`, `--band-blue-soft:#DBEAFE`, `--gray-soft:#F1F5F9`, `--text-light:#94A3B8` (+ `@theme inline` color mappings for the new four).
- `Shell` props: `{title: string; subtitle?: string; actions?: ReactNode; children}` — sidebar per mockup lines 820–854 (brand block "NEXUS"/"Talent Match", "Workspace" section label; company nav: Start new search `/dashboard/campaigns/new`, Search library `/dashboard`, Outreach queue `/dashboard/outreach` + emerald count badge (from `GET /api/outreach/queue` length, poll 30s, hidden when 0), Sent outreach `/dashboard/outreach/sent`; "Settings" label + Workspace settings `/dashboard/settings`; admin nav: existing Companies/Audit items, same styling), user box (avatar initials, name, "{role label} · {company}", ↩ signout). Topbar: white, sticky, title+subtitle left, `actions` right. Content: `max-w-[1200px] px-8 py-6`.
- `lib/bands.ts`:

```typescript
export type Band = "ideal" | "good" | "moderate" | "not_fit" | "unscored";
export const BAND_META: Record<Band, { label: string; tag: string; bar: string; desc: string }> = {
  ideal:    { label: "Ideal Match",  tag: "bg-verdict-pass-soft text-emerald-900",  bar: "bg-verdict-pass", desc: "Meets essentially every requirement" },
  good:     { label: "Good Fit",     tag: "bg-band-blue-soft text-blue-900",        bar: "bg-band-blue",    desc: "Meets the bar with minor gaps" },
  moderate: { label: "Moderate Fit", tag: "bg-verdict-hold-soft text-amber-900",    bar: "bg-verdict-hold", desc: "Just below the bar — worth reviewing" },
  not_fit:  { label: "Not a Fit",    tag: "bg-gray-soft text-muted-foreground",     bar: "bg-text-light",   desc: "Didn't meet the requirements" },
  unscored: { label: "Pending",      tag: "bg-gray-soft text-muted-foreground",     bar: "bg-text-light",   desc: "Not yet scored" },
};
```

- `StatusDot({kind})`: kind "complete"|"running"|"review"|"cancelled"|"error" → colored 8px dot (running pulses), per mockup lines 384–396.
- `FilterChip({active, onClick, children})` per mockup lines 406–417 (999px pill; active = dark `bg-foreground text-white`).

- [ ] **Step 1:** Update `:root` tokens; delete dark-theme block if present (mockup is light-only) — check `globals.css` beyond line 60 for `.dark` and font-display usage before removing anything still referenced.
- [ ] **Step 2:** Rebuild Shell with the new contract; update ALL existing `<Shell title=...>` call sites to compile (they keep working — `subtitle` optional).
- [ ] **Step 3:** Login page per mockup lines 691–815: full-viewport `bg-gradient-to-br from-[#0A1F1A] to-[#143329]`, white card w-full max-w-[400px] rounded-[14px] p-10, brand block (tracking-[2px] emerald "NEXUS" 11px / "Talent Match" 22px bold / "Sign in to your workspace" muted), existing form logic unchanged, full-width primary button, footer "New workspace? Get in touch with your MasterTech onboarder." Reset-password gets the same wrapper/card.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm run lint` (only pre-existing errors) + visually check login + an existing dashboard page renders in the new shell.
- [ ] **Step 5:** Commit `feat: mockup design tokens, Talent Match shell, login restyle`.

---

### Task 7: Search library page

**Files:**
- Rewrite: `frontend/src/app/dashboard/page.tsx`
- Modify: `frontend/src/lib/api.ts` (Campaign list type → new row shape from Task 2)

**Interfaces:**
- Consumes `GET /api/campaigns` rows (Task 2 shape), `StatusDot`, `FilterChip`.
- Produces `libraryStatus(row) -> {kind, label}`: Error→(error,"Error"); Cancelled→(cancelled,"Cancelled"); Watching→(running,"Watching folder"); Queued/Processing→(running,"Running"); Completed + counts.pending_review>0→(review,"Awaiting review"); else (complete,"Completed"). Exported from `lib/bands.ts` for reuse in detail page.

- [ ] **Step 1:** Build per mockup lines 859–935: topbar ("Search library" / "All talent searches for {company.name}" via existing `useQuery my-company`; primary "+ Start new search"), filter chips [All searches, Active, Awaiting review, Completed, Cancelled] filtering client-side on `libraryStatus`, table (`Search name` bold · Role (`role_title` or "—") · Status (dot+label) · `{processed} of {total}` · Recommended (`counts.recommended` or "—" when 0 processed; append `· {approved} approved` muted when >0) · Last activity (relative from `finished_at ?? created_at` — write `lib/relative-time.ts` with `relTime(iso): string` using `Intl.RelativeTimeFormat`, units up to weeks)). Row click → `/dashboard/campaigns/{id}`. Empty state: card "No searches yet — start your first search."
- [ ] **Step 2:** `npx tsc --noEmit`; manual check with real data.
- [ ] **Step 3:** Commit `feat: search library page`.

---

### Task 8: Start new search form

**Files:**
- Rewrite: `frontend/src/app/dashboard/campaigns/new/page.tsx`
- Create: `frontend/src/components/accordion-section.tsx`, `frontend/src/components/chips-input.tsx`, `frontend/src/components/file-drop.tsx`
- Modify: `frontend/src/lib/requirements.ts` (add: `role_title`, `urgency`, `team_context`, `culture_text`, `positive_signals`, `concern_signals` to type + defaults)

**Interfaces:**
- `AccordionSection({title, desc, pill: "hard"|"pref"|"flag"|"off", defaultOpen?, children})` per mockup lines 263–307 (pill styles lines 283–294: hard = danger soft, pref = blue soft, flag = neutral).
- `ChipsInput({value: string[], onChange, placeholder, strong?})` per lines 309–339 (Enter/comma adds, × removes, strong = emerald chips).
- `FileDrop({accept, multiple?, onFiles, primary, secondary})` per lines 249–260 with drag-over highlight; wraps a hidden `<input type=file>`.
- Keeps ALL existing submit mechanics (FormData, intake_mode, folder binding via `saveBinding`, isFolderAlreadyBound guard, zero-resume folder mode).

- [ ] **Step 1:** Components (mockup-faithful classes).
- [ ] **Step 2:** Rebuild the page per mockup lines 938–1315 with real field mapping:
  - Card "The role": Search name→`campaign_name`; Role title→`requirements.role_title`; Openings→`openings`; JD FileDrop→`jd_file`; Urgency select→`urgency` (hint verbatim: "Only affects your view of pace on the search — the agent works at the same speed."); Target start date `<input type="date">`→`target_join_date`.
  - Card "Where we'll search": intake toggle + FileDrop (upload) / choose-folder (folder) + blue banner "Folder watching syncs while the app is open in your browser." (our copy, mockup banner style lines 342–354).
  - Card "What matters beyond the JD" (sub copy verbatim from line 1037): sections → existing profile fields: 1 Team & seniority (pref, open: seniority select, industries ChipsInput, team_context input); 2 Location & work mode (hard, open: office_location single-chip input, work_mode select, commute_rule select, relocation_acceptable select); 3 Must-have skills & credentials (pref, open: must_have_skills strong ChipsInput mapping to `[{skill, min_years:null}]`, nice_to_have_skills, licenses ChipsInput (hint "treated as hard requirements", sets licenses_mode:"hard_filter" when non-empty), education select Any→`education_degree_required:false` / "Degree required"→true); 4 Compensation (flag pill: budget_min/max + budget_currency select GBP/USD/INR + banner verbatim lines 1208–1211); 5 Availability (pref: max_notice_days select [30/60/90 days→"1 month/2 months/3 months"], travel_percent_max select, shift select); 6 What makes someone thrive here (pref: culture_text textarea + positive_signals/concern_signals ChipsInput); 7 Absolute dealbreakers (hard: textarea, hint verbatim line 1303).
  - Topbar: Cancel → `/dashboard`; primary "Start search" → submit → push to detail page. Validation: name, role title, JD; upload mode ≥1 resume.
- [ ] **Step 3:** `npx tsc --noEmit` + lint + manually create a search end-to-end.
- [ ] **Step 4:** Commit `feat: start-new-search form with accordion requirements`.

---

### Task 9: Progress view + cancel

**Files:**
- Modify: `frontend/src/app/dashboard/campaigns/[id]/page.tsx` (split render: `<ProgressView>` when status ∈ {Watching, Queued, Processing}, else results)
- Create: `frontend/src/components/progress-hero.tsx`

**Interfaces:**
- Consumes detail endpoint (`campaign.status`, `processed_count`, `total_count`, counts of banded candidates from `candidates[].band`), `POST /api/campaigns/{id}/cancel`.
- `ProgressHero({campaign, processed, total, recommended, companyName, onCancel})`.

- [ ] **Step 1:** Build per mockup lines 1317–1370: status label (WATCHING FOLDER / QUEUED / WORKING), line "Scoring candidate {processed+1} of {total} against {company}'s requirements" (Watching: "Waiting for the first resumes to appear in the folder"; Queued: "In line behind another search"), bar width `processed/total`, stats (scored · est remaining · recommended so far). ETA: keep a ref of (time, processed) samples during polling; when ≥2 samples and processing, `remaining = (total-processed) * avgSecPerCandidate`, display "~N min remaining"; omit otherwise. Stages: 1 done when `total>0 && (processed>0 || campaign.unified_profile_exists)` — detail endpoint returns full campaign ORM so `unified_profile` key exists; treat non-null as done; 2 done when any candidate parsed (`processed>0` or any parsed_text non-empty flag — simply: done when status=="Processing" and total>0); 3 active while Processing; 4 done at Completed. Keep it honest but simple; exact thresholds are cosmetic.
- [ ] **Step 2:** Danger "Cancel search" topbar button → confirm via `window.confirm("Cancel this search? Partial results are kept.")` → POST cancel → invalidate queries (page flips to results view with gray "This search was cancelled — results below are partial." banner).
- [ ] **Step 3:** tsc + manual: create a search, watch progress, cancel one.
- [ ] **Step 4:** Commit `feat: human-readable progress view with cancel`.

---

### Task 10: Results view (bands, filters, rows)

**Files:**
- Modify: `frontend/src/app/dashboard/campaigns/[id]/page.tsx` (results half)
- Create: `frontend/src/components/band-strip.tsx`, `frontend/src/components/candidate-row.tsx`

**Interfaces:**
- Consumes `candidates[].band` (Task 2), `BAND_META`, PATCH review_status.
- `BandStrip({counts: Record<Band, number>, active: Band|null, onSelect})` per mockup lines 420–447 & 1386–1407 (top color bar via `::before` → use an absolutely-positioned div).
- `CandidateRow({c, rank, onOpen, onApprove, onReject})` grid `[40px_90px_1fr_1fr_130px_100px]` per lines 450–503 & 1423–1516: rank, band tag, name + meta (meta = `{c.name ? c.original_filename : ""} · {estimated years if in judgments}` — build from available fields: prefer `judgments.estimated_total_years` + original_filename), rationale 2-line clamp, signals column (flags: `over_budget`→"£ Over budget" amber, `culture_match`→"◆ Strong culture match" emerald, `culture_concern`→"Culture concern" amber, needs_info non-empty→"Needs info" amber), approve ✓ / reject × icon buttons (PATCH review_status, optimistic invalidate; approved rows show a filled ✓ state).

- [ ] **Step 1:** Topbar per lines 1374–1383: subtitle "{total} candidates reviewed · {recommended} recommended · Completed {relTime}", actions "↓ Export to Excel" (existing `/export.csv` link) + "Review outreach drafts →" → `/dashboard/outreach`.
- [ ] **Step 2:** Band strip (click toggles band filter; Not-a-Fit card sub-line "Includes N dealbreaker rejections" where N = hard_filter_failed count). Filter bar: search input (name/rationale substring) + chips: `All {recommended} recommended` (default: bands ideal+good) · Not yet reviewed (review_status pending within recommended) · Approved · Over budget · Flagged. Band-card selection overrides chip to show that band's rows.
- [ ] **Step 3:** Rows sorted score-desc within band order (ideal→good→moderate→not_fit); footer line "+ N more in Not a Fit" style when a filter hides rows (only if needed — otherwise render all rows; virtualization unnecessary at ≤200).
- [ ] **Step 4:** Keep Error status UI (existing retry button restyled with new `.btn` look) and the cancelled banner from Task 9.
- [ ] **Step 5:** tsc + manual pass; commit `feat: banded results view`.

---

### Task 11: Candidate drawer

**Files:**
- Create: `frontend/src/components/candidate-drawer.tsx`
- Modify: `frontend/src/app/dashboard/campaigns/[id]/page.tsx` (replace the current expanding row/score-tile detail with drawer open on row click)

**Interfaces:**
- `CandidateDrawer({candidate, threshold, onClose, onReview(status), onApproveForOutreach})` — fixed right panel 560px per mockup lines 548–638 & 1658–1748.
- Data mapping: band tag + `candidate.name` + meta; score panel `score/100` + rationale as the "why" text; rubric rows from `candidate.judgments` — inspect its real shape first (`judgments` was built by `scoring.judgment_record`; grep it: it stores per-bucket entries with points/cap/justifications). Render one row per bucket {Required skills match, Hard requirements, Experience, Education, Nice-to-haves} with awarded/cap and the per-item ✓/✗ line, then a total row "{sum arithmetic} = {score} · compliance check passed"; strengths from `get_strengths()`-style JSON field (`key_strengths` JSON string — parse), gaps from `key_gaps`; needs_info list → amber banner "Couldn't verify: {list} — worth checking on a call."
- Sticky footer: Reject / Mark for later / Approve for outreach → (primary; PATCH review_status:"approved" then router.push("/dashboard/outreach")).

- [ ] **Step 1:** Read `backend/src/ai_candidate_screening_outreach/pipeline/scoring.py::judgment_record` to get the exact keys before writing the rubric renderer; render defensively (missing judgments → show score + strengths/gaps only).
- [ ] **Step 2:** Build drawer + backdrop (fixed, translate-x transition, ESC + backdrop click close).
- [ ] **Step 3:** tsc + manual: open drawer on a completed search, verify rubric numbers sum.
- [ ] **Step 4:** Commit `feat: candidate detail drawer with rubric breakdown`.

---

### Task 12: Outreach queue + sent pages

**Files:**
- Create: `frontend/src/app/dashboard/outreach/page.tsx`, `frontend/src/app/dashboard/outreach/sent/page.tsx`, `frontend/src/components/email-preview.tsx`
- Modify: `frontend/src/lib/api.ts` (queue/sent/send helpers + types)

**Interfaces:**
- Consumes Task 4 endpoints. `EmailPreview({from, to, subject, body, onBodyChange})` per mockup lines 673–688 & 1560–1573: header rows (From = `me.email`, To = candidate email or "on file — parsed from resume", Subject = `"{role_title} role at {company} — thought you'd be a strong fit"` prefilled editable), body `contentEditable` div seeded from `email_draft` (plain-text paragraphs → `<p>`), `onBodyChange` on input.
- Send payload: `{email_body: <plain text of edited body>, sms_body}` → `POST .../send`.

- [ ] **Step 1:** Queue page per lines 1524–1592: 320px list (name + "{role} · {band label}", selected = emerald soft) + detail with tabs Email / SMS / "LinkedIn (Phase 2)" disabled right-aligned; footer hint verbatim ("Draft edited manually — the 'from' and 'to' fields cannot be changed here…" adapted: From/To locked) + actions: Skip this candidate (PATCH review_status:"later", removes from queue) · Approve & send now (placeholder check client-side first — regex `\[[^\]]+\]` → inline warning listing tokens; on success invalidate queue + badge). Topbar: "Approve & send all" = iterate sendable items sequentially, skipping ones that fail placeholder check, report "{n} sent · {m} skipped (placeholders)". Empty state: "Nothing waiting — approve candidates from a search's results to queue outreach."
- [ ] **Step 2:** Sent page per lines 1596–1618: table Candidate · Search · Sent (relTime) · Sent by. No Response column.
- [ ] **Step 3:** tsc + manual full flow: approve in drawer → queue → edit → send → sent page + badge decrements.
- [ ] **Step 4:** Commit `feat: outreach queue and sent pages`.

---

### Task 13: Settings page + admin restyle

**Files:**
- Create: `frontend/src/app/dashboard/settings/page.tsx`
- Modify: `frontend/src/app/admin/page.tsx`, `frontend/src/app/admin/companies/**`, `frontend/src/app/admin/audit/page.tsx` (shell props/classes only)

- [ ] **Step 1:** Settings (OUR layout, not mockup's): Shell title "Workspace settings" subtitle "Read-only here · changes go through your MasterTech onboarder"; one card with disabled inputs from `GET /api/my/company`: Company, Region, Default threshold, Office locations, Recruiter signature, Tone notes, Data retention. (Data present in the `my/company` response — extend that endpoint's dict with `recruiter_signature`, `tone_notes`, `data_retention_days` if missing; check first.)
- [ ] **Step 2:** Admin pages: ensure they render correctly inside the rebuilt Shell (new props), sweep for hardcoded old-token classes that now look broken; adjust minimally.
- [ ] **Step 3:** tsc + lint + commit `feat: settings page; admin on new shell`.

---

### Task 14: End-to-end verification

- [ ] **Step 1:** `uv run pytest -q` → all pass. `npx tsc --noEmit`, `npm run lint` (no NEW errors), `npm run build` → clean.
- [ ] **Step 2:** Manual side-by-side vs mockup (Chrome, both dev servers): login → library → new search (all 7 sections, both intakes) → progress (+cancel on a throwaway) → results (bands, filters, search) → drawer (rubric arithmetic) → approve → queue (edit, placeholder block, send) → sent. Admin login sanity. Folder watcher still functions (binding, banner).
- [ ] **Step 3:** Screenshot key screens for the user to compare.
- [ ] **Step 4:** Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch.
