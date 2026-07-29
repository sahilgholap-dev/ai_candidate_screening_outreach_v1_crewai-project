# Watched-Folder Resume Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recruiter bind a local folder to a campaign; while the app is open in Chrome/Edge, new resumes dropped into the folder are uploaded and screened incrementally. Manual upload remains the default mode.

**Architecture:** Browser watches the folder (File System Access API) and diffs against a server-side manifest of SHA-256 content hashes. New backend endpoints add resumes to an existing campaign and enqueue incremental runs; the runner is changed to screen only unscreened candidates. Spec: `docs/superpowers/specs/2026-07-29-watched-folder-ingestion-design.md`.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend, `uv`), Next.js App Router + TypeScript + TanStack Query (frontend), IndexedDB for directory handles, `crypto.subtle` for hashing.

## Global Constraints

- Backend commands run from `backend/`: `uv run pytest -q`, `uv run alembic upgrade head`.
- Frontend commands run from `frontend/`: `npx tsc --noEmit`, `npm run lint`.
- Allowed resume extensions: `.pdf`, `.docx`, `.txt` (backend `ALLOWED_UPLOAD_EXTENSIONS`); max 10 MB/file; max 200 resumes/campaign (`MAX_RESUMES_PER_CAMPAIGN`).
- Campaign statuses: `Pending, Queued, Processing, Completed, Error` + new `Watching`.
- New DB columns: `campaigns.intake_mode` (`"upload"`|`"folder"`, default `"upload"`), `campaigns.folder_name` (nullable), `candidates.content_hash` (nullable, sha256 hex).
- The frontend is Next.js 16 — before writing frontend code, skim the relevant guide in `frontend/node_modules/next/dist/docs/` (per `frontend/AGENTS.md`).
- No secrets in commits. Commit after each task.

---

### Task 1: DB columns + migration

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/db/models.py` (Campaign ~line 194, Candidate ~line 231)
- Create: `backend/alembic/versions/<autogen-id>_watched_folder_columns.py` (via `uv run alembic revision -m "watched-folder columns"`)

**Interfaces:**
- Produces: `Campaign.intake_mode: str`, `Campaign.folder_name: str | None`, `Candidate.content_hash: str | None` — used by Tasks 2–5.

- [ ] **Step 1: Add model columns**

In `models.py`, Campaign — after the `status` column line:

```python
    # "upload" (manual select-and-upload) | "folder" (browser-watched folder)
    intake_mode = Column(String, default="upload", nullable=False)
    folder_name = Column(String, nullable=True)  # display-only; browsers never expose full paths
```

Candidate — after `original_filename`:

```python
    content_hash = Column(String, nullable=True, index=True)  # sha256 of file bytes; dedup key
```

- [ ] **Step 2: Create migration**

Run: `uv run alembic revision -m "watched-folder columns"`, then fill the generated file:

```python
def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("campaigns") as batch_op:
        batch_op.add_column(
            sa.Column("intake_mode", sa.String(), nullable=False, server_default="upload")
        )
        batch_op.add_column(sa.Column("folder_name", sa.String(), nullable=True))
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.add_column(sa.Column("content_hash", sa.String(), nullable=True))
        batch_op.create_index("ix_candidates_content_hash", ["content_hash"])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("candidates") as batch_op:
        batch_op.drop_index("ix_candidates_content_hash")
        batch_op.drop_column("content_hash")
    with op.batch_alter_table("campaigns") as batch_op:
        batch_op.drop_column("folder_name")
        batch_op.drop_column("intake_mode")
```

- [ ] **Step 3: Apply and verify**

Run: `uv run alembic upgrade head`
Expected: `Running upgrade ... watched-folder columns`, no errors.
Note: local `.env` points `DATABASE_URL` at the shared staging Postgres — applying is intended (feature ships there anyway).

- [ ] **Step 4: Run existing tests**

Run: `uv run pytest -q` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai_candidate_screening_outreach/db/models.py backend/alembic/versions/*watched_folder*
git commit -m "feat: campaign intake_mode/folder_name and candidate content_hash columns"
```

---

### Task 2: API test harness (conftest)

**Files:**
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Produces: pytest fixtures `client` (FastAPI TestClient, isolated temp SQLite DB, queue worker disabled), `company_auth` (dict of Authorization headers for a company user), `make_campaign(client, company_auth, **overrides)` helper exported as fixture `create_campaign_fn`. Used by Tasks 3–5.

- [ ] **Step 1: Write conftest**

```python
"""API test harness: isolated temp SQLite DB, queue worker disabled.

Env vars MUST be set before any app import — database.py reads DATABASE_URL
at import time.
"""

import os
import sys
import tempfile

_TMPDIR = tempfile.mkdtemp(prefix="screening-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMPDIR}/test.db"
os.environ["DISABLE_QUEUE_WORKER"] = "1"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ai_candidate_screening_outreach.app import app  # noqa: E402
from ai_candidate_screening_outreach.auth.security import hash_password  # noqa: E402
from ai_candidate_screening_outreach.db.database import SessionLocal  # noqa: E402
from ai_candidate_screening_outreach.db.models import Company, User  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def company_auth(client):
    db = SessionLocal()
    try:
        company = Company(name="TestCo", default_region="IN")
        db.add(company)
        db.flush()
        user = User(
            email="user@testco.example",
            password_hash=hash_password("pw123456"),
            role="company_user",
            company_id=company.id,
            must_reset_password=False,
            is_active=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()
    res = client.post(
        "/api/auth/login",
        json={"email": "user@testco.example", "password": "pw123456"},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


PDF_STUB = b"%PDF-1.4 stub"  # never parsed in tests (worker disabled)


@pytest.fixture
def create_campaign_fn(client, company_auth):
    def _create(intake_mode="upload", resumes=(("r1.txt", b"resume one"),), folder_name=None):
        files = [("jd_file", ("jd.txt", b"a job description", "text/plain"))]
        for fname, fbytes in resumes:
            files.append(("resume_files", (fname, fbytes, "text/plain")))
        data = {
            "campaign_name": "T",
            "threshold": "65",
            "region": "IN",
            "intake_mode": intake_mode,
        }
        if folder_name:
            data["folder_name"] = folder_name
        res = client.post(
            "/api/campaigns", data=data, files=files, headers=company_auth
        )
        return res

    return _create
```

- [ ] **Step 2: Sanity-run existing suite with the new conftest**

Run: `uv run pytest -q`
Expected: existing 21 tests still pass (conftest imports app but existing tests don't use fixtures).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test: API test harness with temp SQLite DB and auth fixture"
```

---

### Task 3: Folder-mode campaign creation (zero resumes → Watching)

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/app.py` (`create_campaign`, ~lines 133–229)
- Create: `backend/tests/test_folder_intake.py`

**Interfaces:**
- Consumes: Task 1 columns, Task 2 fixtures.
- Produces: `POST /api/campaigns` accepts `intake_mode` + `folder_name` form fields; `resume_files` optional in folder mode; zero-resume folder campaigns get `status="Watching"` and are not enqueued; every stored resume gets `content_hash`.

- [ ] **Step 1: Write failing tests**

`backend/tests/test_folder_intake.py`:

```python
"""Folder-intake campaign creation semantics."""

import hashlib

from ai_candidate_screening_outreach.db.database import SessionLocal
from ai_candidate_screening_outreach.db.models import Campaign, Candidate


def _campaign(campaign_id):
    db = SessionLocal()
    try:
        return db.query(Campaign).filter(Campaign.id == campaign_id).first()
    finally:
        db.close()


def test_upload_mode_requires_resumes(create_campaign_fn):
    res = create_campaign_fn(intake_mode="upload", resumes=())
    assert res.status_code == 422


def test_folder_mode_zero_resumes_creates_watching(create_campaign_fn):
    res = create_campaign_fn(intake_mode="folder", resumes=(), folder_name="My Resumes")
    assert res.status_code == 200, res.text
    c = _campaign(res.json()["campaign_id"])
    assert c.status == "Watching"
    assert c.intake_mode == "folder"
    assert c.folder_name == "My Resumes"


def test_folder_mode_with_initial_resumes_queues(create_campaign_fn):
    res = create_campaign_fn(
        intake_mode="folder", resumes=(("a.txt", b"abc"),), folder_name="F"
    )
    assert res.status_code == 200, res.text
    c = _campaign(res.json()["campaign_id"])
    assert c.status == "Queued"


def test_resumes_get_content_hash(create_campaign_fn):
    res = create_campaign_fn(resumes=(("a.txt", b"abc"),))
    campaign_id = res.json()["campaign_id"]
    db = SessionLocal()
    try:
        cand = db.query(Candidate).filter(Candidate.campaign_id == campaign_id).first()
        assert cand.content_hash == hashlib.sha256(b"abc").hexdigest()
    finally:
        db.close()


def test_invalid_intake_mode_rejected(create_campaign_fn):
    res = create_campaign_fn(intake_mode="carrier-pigeon")
    assert res.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_folder_intake.py -v`
Expected: FAIL (intake_mode form field not accepted / zero resumes rejected with FastAPI validation error).

- [ ] **Step 3: Implement in `create_campaign`**

Add `import hashlib` at top of app.py. Change the signature:

```python
    resume_files: List[UploadFile] = File(default=[]),
    intake_mode: str = Form("upload"),
    folder_name: str | None = Form(None),
```

After the admin check, validate mode and emptiness:

```python
    if intake_mode not in {"upload", "folder"}:
        raise HTTPException(status_code=422, detail="intake_mode must be 'upload' or 'folder'")
    if intake_mode == "upload" and not resume_files:
        raise HTTPException(status_code=422, detail="Upload at least one resume")
```

In the Campaign(...) constructor add:

```python
        intake_mode=intake_mode,
        folder_name=folder_name,
        status="Watching" if intake_mode == "folder" and not validated_resumes else "Queued",
```

(keep the existing `status="Queued"` line replaced by the conditional above).

In the resume loop, compute and store the hash:

```python
        db.add(
            Candidate(
                campaign_id=new_campaign.id,
                original_filename=safe_name,
                parsed_text="",  # parsed by background task
                content_hash=hashlib.sha256(r_bytes).hexdigest(),
            )
        )
```

At the bottom, only enqueue when there is something to run:

```python
    if validated_resumes:
        enqueue_campaign(db, new_campaign)
```

Also add `"intake_mode": intake_mode` to the `campaign.created` audit detail dict.

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_folder_intake.py -v` — Expected: PASS.
Run: `uv run pytest -q` — Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai_candidate_screening_outreach/app.py backend/tests/test_folder_intake.py
git commit -m "feat: folder intake mode; zero-resume campaigns wait in Watching"
```

---

### Task 4: Manifest + add-resumes endpoints

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/app.py` (new endpoints after `create_campaign`)
- Test: `backend/tests/test_add_resumes.py`

**Interfaces:**
- Consumes: `_campaign_query`, `_validate_upload`, `MAX_RESUMES_PER_CAMPAIGN`, `enqueue_campaign`, `log_action`, Task 1 columns.
- Produces:
  - `GET /api/campaigns/{campaign_id}/resume-manifest` → `{"resumes": [{"content_hash": str|None, "original_filename": str}]}`
  - `POST /api/campaigns/{campaign_id}/resumes` (multipart `resume_files`) → `{"added": [filename], "skipped": [filename], "status": campaign.status}`
  - New files are parsed into `parsed_text` at upload time (MUST: the runner deletes the upload dir after each run, and Railway disk is ephemeral).

- [ ] **Step 1: Write failing tests**

`backend/tests/test_add_resumes.py`:

```python
"""Incremental resume addition + manifest."""

from ai_candidate_screening_outreach.db.database import SessionLocal
from ai_candidate_screening_outreach.db.models import Campaign, Candidate


def _post_resumes(client, auth, campaign_id, *files):
    return client.post(
        f"/api/campaigns/{campaign_id}/resumes",
        files=[("resume_files", (n, b, "text/plain")) for n, b in files],
        headers=auth,
    )


def test_manifest_lists_hashes(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("a.txt", b"abc"),)).json()["campaign_id"]
    res = client.get(f"/api/campaigns/{cid}/resume-manifest", headers=company_auth)
    assert res.status_code == 200
    resumes = res.json()["resumes"]
    assert len(resumes) == 1
    assert resumes[0]["original_filename"] == "a.txt"
    assert len(resumes[0]["content_hash"]) == 64


def test_add_resumes_appends_and_queues(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(
        intake_mode="folder", resumes=(), folder_name="F"
    ).json()["campaign_id"]
    res = _post_resumes(client, company_auth, cid, ("new.txt", b"new resume text"))
    assert res.status_code == 200, res.text
    assert res.json()["added"] == ["new.txt"]
    db = SessionLocal()
    try:
        c = db.query(Campaign).filter(Campaign.id == cid).first()
        assert c.status == "Queued"
        cand = db.query(Candidate).filter(Candidate.campaign_id == cid).first()
        assert cand.parsed_text  # parsed at upload time, not run time
    finally:
        db.close()


def test_add_resumes_dedups_by_hash(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("a.txt", b"abc"),)).json()["campaign_id"]
    res = _post_resumes(client, company_auth, cid, ("copy-of-a.txt", b"abc"))
    assert res.json()["added"] == []
    assert res.json()["skipped"] == ["copy-of-a.txt"]


def test_add_resumes_does_not_requeue_processing(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("a.txt", b"abc"),)).json()["campaign_id"]
    db = SessionLocal()
    try:
        db.query(Campaign).filter(Campaign.id == cid).update({"status": "Processing"})
        db.commit()
    finally:
        db.close()
    _post_resumes(client, company_auth, cid, ("b.txt", b"bcd"))
    db = SessionLocal()
    try:
        assert db.query(Campaign).filter(Campaign.id == cid).first().status == "Processing"
    finally:
        db.close()


def test_add_resumes_enforces_campaign_cap(client, company_auth, create_campaign_fn, monkeypatch):
    import ai_candidate_screening_outreach.app as app_module

    monkeypatch.setattr(app_module, "MAX_RESUMES_PER_CAMPAIGN", 1)
    cid = create_campaign_fn(resumes=(("a.txt", b"abc"),)).json()["campaign_id"]
    res = _post_resumes(client, company_auth, cid, ("b.txt", b"bcd"))
    assert res.status_code == 422


def test_add_resumes_unknown_campaign_404(client, company_auth):
    res = _post_resumes(client, company_auth, 999999, ("a.txt", b"abc"))
    assert res.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_add_resumes.py -v` — Expected: FAIL with 404 (routes don't exist).

- [ ] **Step 3: Implement both endpoints** (in app.py, after `create_campaign`)

```python
@app.get("/api/campaigns/{campaign_id}/resume-manifest")
async def resume_manifest(
    campaign_id: int,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    """Hashes of resumes already attached — the folder watcher diffs against this."""
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    rows = db.query(Candidate).filter(Candidate.campaign_id == campaign_id).all()
    return {
        "resumes": [
            {"content_hash": c.content_hash, "original_filename": c.original_filename}
            for c in rows
        ]
    }


@app.post("/api/campaigns/{campaign_id}/resumes")
async def add_resumes(
    campaign_id: int,
    resume_files: List[UploadFile] = File(...),
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    """Append resumes to an existing campaign and enqueue an incremental run.

    Files are parsed into parsed_text NOW: the runner deletes the upload dir
    after each run and Railway's disk is ephemeral, so disk can't be relied on
    between upload and run.
    """
    from ai_candidate_screening_outreach.pipeline.runner import _extract_file_text

    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    existing = db.query(Candidate).filter(Candidate.campaign_id == campaign_id).all()
    existing_hashes = {c.content_hash for c in existing if c.content_hash}
    if len(existing) + len(resume_files) > MAX_RESUMES_PER_CAMPAIGN:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_RESUMES_PER_CAMPAIGN} resumes per campaign",
        )

    upload_dir = os.path.join(BASE_DIR, "uploads", f"campaign_{campaign_id}")
    os.makedirs(upload_dir, exist_ok=True)

    added: list[str] = []
    skipped: list[str] = []
    for r_file in resume_files:
        r_bytes = await r_file.read()
        safe_name = _validate_upload(r_file.filename, r_bytes, "Resume")
        content_hash = hashlib.sha256(r_bytes).hexdigest()
        if content_hash in existing_hashes:
            skipped.append(safe_name)
            continue
        file_path = os.path.join(upload_dir, safe_name)
        with open(file_path, "wb") as f:
            f.write(r_bytes)
        db.add(
            Candidate(
                campaign_id=campaign_id,
                original_filename=safe_name,
                parsed_text=_extract_file_text(file_path),
                content_hash=content_hash,
            )
        )
        existing_hashes.add(content_hash)
        added.append(safe_name)

    if added:
        log_action(
            db,
            "campaign.resumes_added",
            user=user,
            detail={
                "campaign_id": campaign_id,
                "added": len(added),
                "skipped": len(skipped),
                "intake_mode": campaign.intake_mode,
            },
        )
        if campaign.status not in {"Queued", "Processing"}:
            campaign.status = "Queued"
    db.commit()
    return {"added": added, "skipped": skipped, "status": campaign.status}
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_add_resumes.py -v` then `uv run pytest -q` — Expected: PASS / all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai_candidate_screening_outreach/app.py backend/tests/test_add_resumes.py
git commit -m "feat: resume-manifest and add-resumes endpoints with hash dedup"
```

---

### Task 5: Incremental runner (screen only unscreened; self-requeue)

**Files:**
- Modify: `backend/src/ai_candidate_screening_outreach/pipeline/runner.py` (dedup block ~lines 198–214, finalize ~lines 397–406)
- Test: `backend/tests/test_incremental_runner.py`

**Interfaces:**
- Consumes: `Candidate` model, `_contact_keys` (existing in runner).
- Produces: `_partition_candidates(candidates: list[Candidate]) -> list[Candidate]` — marks fresh duplicates, returns only unscreened candidates to process; finalize re-queues when unscreened candidates remain; `final_report` is appended to (not overwritten) on incremental runs.

- [ ] **Step 1: Write failing tests**

`backend/tests/test_incremental_runner.py` (pure unit tests — Candidate objects are plain instances, no DB):

```python
"""Incremental screening: only unscreened candidates are processed."""

from ai_candidate_screening_outreach.db.models import Candidate
from ai_candidate_screening_outreach.pipeline.runner import _partition_candidates


def _cand(id, text, score=None, recommendation=None):
    c = Candidate(campaign_id=1, original_filename=f"{id}.txt", parsed_text=text)
    c.id = id
    c.score = score
    c.recommendation = recommendation
    return c


def test_screened_candidates_are_skipped():
    cands = [
        _cand(1, "email: a@x.com", score=80, recommendation="Shortlist"),
        _cand(2, "email: b@x.com"),
    ]
    assert [c.id for c in _partition_candidates(cands)] == [2]


def test_new_duplicate_of_screened_candidate_is_marked():
    cands = [
        _cand(1, "email: a@x.com", score=80, recommendation="Shortlist"),
        _cand(2, "email: a@x.com"),  # same contact, new file
    ]
    result = _partition_candidates(cands)
    assert result == []
    assert cands[1].recommendation == "Duplicate"


def test_screened_duplicate_is_not_remarked():
    cands = [
        _cand(1, "email: a@x.com", score=80, recommendation="Shortlist"),
        _cand(2, "email: a@x.com", recommendation="Duplicate"),
    ]
    result = _partition_candidates(cands)
    assert result == []
    assert cands[1].recommendation == "Duplicate"


def test_fresh_campaign_all_processed_duplicates_marked():
    cands = [
        _cand(1, "email: a@x.com"),
        _cand(2, "email: b@x.com"),
        _cand(3, "email: a@x.com"),
    ]
    assert [c.id for c in _partition_candidates(cands)] == [1, 2]
    assert cands[2].recommendation == "Duplicate"
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_incremental_runner.py -v`
Expected: FAIL with "cannot import name '_partition_candidates'".

- [ ] **Step 3: Implement**

In runner.py, replace the inline dedup block (the `seen`/`to_process` loop inside `run_campaign`) with a call to a new module-level function, defined near `_contact_keys`:

```python
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
```

In `run_campaign`, the block becomes:

```python
        # ---- 2. Cross-campaign dedup by email/phone; skip already-screened ----
        to_process = _partition_candidates(candidates)
        db.commit()
```

In the finalize section, append instead of overwrite when this was an incremental run, and self-requeue if new resumes arrived mid-run:

```python
        # ---- 5. Finalize ----
        if failed_chunks:
            final_content += f"\n\n> Note: {failed_chunks} of {total_chunks} batches failed processing.\n"
        if campaign.final_report and to_process:
            campaign.final_report += (
                f"\n\n---\n\n# Incremental run ({len(to_process)} new candidate(s))\n\n"
                + final_content
            )
        elif to_process or not campaign.final_report:
            campaign.final_report = final_content
        campaign.token_usage = total_usage
        campaign.finished_at = utcnow()
        db.expire_all()  # pick up candidates added by the API while we ran
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
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_incremental_runner.py -v` then `uv run pytest -q` — Expected: PASS / all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ai_candidate_screening_outreach/pipeline/runner.py backend/tests/test_incremental_runner.py
git commit -m "feat: incremental runs screen only unscreened candidates and self-requeue"
```

---

### Task 6: Frontend folder-watch library

**Files:**
- Create: `frontend/src/lib/folder-watch.ts`

**Interfaces:**
- Consumes: browser File System Access API, IndexedDB, `crypto.subtle`.
- Produces (used by Tasks 7–8):
  - `isFolderPickSupported(): boolean`
  - `pickFolder(): Promise<FileSystemDirectoryHandle>` (wraps `window.showDirectoryPicker()`)
  - `saveBinding(campaignId: number, handle: FileSystemDirectoryHandle): Promise<void>`
  - `getBindings(): Promise<{ campaignId: number; handle: FileSystemDirectoryHandle }[]>`
  - `removeBinding(campaignId: number): Promise<void>`
  - `moveBinding(fromCampaignId: number, toCampaignId: number): Promise<void>`
  - `isFolderAlreadyBound(handle: FileSystemDirectoryHandle): Promise<number | null>` (campaignId or null, via `isSameEntry`)
  - `listResumeFiles(handle: FileSystemDirectoryHandle): Promise<File[]>` (`.pdf/.docx/.txt` only)
  - `fileKey(f: { name: string; size: number; lastModified: number }): string`
  - `hashFile(f: File): Promise<string>` (sha256 hex)

- [ ] **Step 1: Write the module**

```typescript
// Folder-watch support: directory-handle persistence (IndexedDB), folder
// scanning, and content hashing. All watching state lives client-side;
// the server only ever sees uploaded files.

export const RESUME_EXTENSIONS = [".pdf", ".docx", ".txt"];

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function isFolderPickSupported(): boolean {
  return typeof window !== "undefined" && !!window.showDirectoryPicker;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("Folder access requires Chrome or Edge");
  }
  return window.showDirectoryPicker({ mode: "read" });
}

// ---- IndexedDB persistence (handles are structured-cloneable) ----

const DB_NAME = "folder-watch";
const STORE = "bindings"; // key: campaignId (number), value: handle

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function saveBinding(
  campaignId: number,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await tx("readwrite", (s) => s.put(handle, campaignId));
}

export async function removeBinding(campaignId: number): Promise<void> {
  await tx("readwrite", (s) => s.delete(campaignId));
}

export async function getBindings(): Promise<
  { campaignId: number; handle: FileSystemDirectoryHandle }[]
> {
  const keys = await tx("readonly", (s) => s.getAllKeys());
  const values = await tx("readonly", (s) => s.getAll());
  return keys.map((k, i) => ({
    campaignId: Number(k),
    handle: values[i] as FileSystemDirectoryHandle,
  }));
}

export async function moveBinding(
  fromCampaignId: number,
  toCampaignId: number,
): Promise<void> {
  const bindings = await getBindings();
  const from = bindings.find((b) => b.campaignId === fromCampaignId);
  if (!from) return;
  await saveBinding(toCampaignId, from.handle);
  await removeBinding(fromCampaignId);
}

export async function isFolderAlreadyBound(
  handle: FileSystemDirectoryHandle,
): Promise<number | null> {
  for (const b of await getBindings()) {
    if (await b.handle.isSameEntry(handle)) return b.campaignId;
  }
  return null;
}

// ---- Scanning & hashing ----

export async function listResumeFiles(
  handle: FileSystemDirectoryHandle,
): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file") continue;
    const lower = entry.name.toLowerCase();
    if (!RESUME_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    files.push(await (entry as FileSystemFileHandle).getFile());
  }
  return files;
}

export function fileKey(f: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

export async function hashFile(f: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

Note: if `handle.values()` needs a TS lib tweak, add minimal interface augmentation in this file rather than changing tsconfig.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/folder-watch.ts
git commit -m "feat: folder-watch library (handle persistence, scanning, hashing)"
```

---

### Task 7: New-campaign page — intake mode selector

**Files:**
- Modify: `frontend/src/app/dashboard/campaigns/new/page.tsx`

**Interfaces:**
- Consumes: Task 6 library, Task 3 backend fields.
- Produces: campaign creation in folder mode with handle saved under the new campaign id.

- [ ] **Step 1: Implement the selector + folder flow**

State additions:

```typescript
const [intakeMode, setIntakeMode] = useState<"upload" | "folder">("upload");
const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
const [folderFiles, setFolderFiles] = useState<File[]>([]);
```

Folder pick handler:

```typescript
async function chooseFolder() {
  setError(null);
  try {
    const handle = await pickFolder();
    const boundTo = await isFolderAlreadyBound(handle);
    if (boundTo !== null) {
      return setError(
        `This folder is already watched by campaign #${boundTo}. One folder per campaign.`,
      );
    }
    setFolderHandle(handle);
    setFolderFiles(await listResumeFiles(handle));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // user cancelled
    setError(e instanceof Error ? e.message : "Couldn't open folder");
  }
}
```

`submit()` changes — resume validation and FormData become mode-dependent:

```typescript
if (intakeMode === "upload" && (!resumeFiles || resumeFiles.length === 0))
  return setError("Upload at least one resume");
if (intakeMode === "folder" && !folderHandle)
  return setError("Choose a folder to watch");
```

```typescript
fd.append("intake_mode", intakeMode);
if (intakeMode === "folder" && folderHandle) {
  fd.append("folder_name", folderHandle.name);
  folderFiles.forEach((f) => fd.append("resume_files", f));
} else {
  Array.from(resumeFiles ?? []).forEach((f) => fd.append("resume_files", f));
}
```

After successful create, before routing:

```typescript
if (intakeMode === "folder" && folderHandle) {
  await saveBinding(data.campaign_id, folderHandle);
}
```

UI: in the "Resumes" grid cell, render a two-button toggle (shadcn `Button` variants, `size="sm"`): "Upload files" / "Watch a folder"; folder button `disabled={!isFolderPickSupported()}` with hint text "Chrome/Edge only" when unsupported. In folder mode show a "Choose folder…" button and, once picked: `📁 {folderHandle.name} — {folderFiles.length} resume(s) found now; new files will be screened automatically while the app is open.` Submit button label in folder mode with zero files: "Create & watch folder".

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — Expected: clean.
Manual: create a folder campaign in Chrome at http://localhost:3000/dashboard/campaigns/new (empty folder → campaign appears with `Watching` status; folder with files → runs normally).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/dashboard/campaigns/new/page.tsx
git commit -m "feat: intake mode selector with folder binding on campaign creation"
```

---

### Task 8: Watcher component (poll, diff, upload, permissions)

**Files:**
- Create: `frontend/src/components/folder-watcher.tsx`
- Modify: `frontend/src/app/providers.tsx` (mount the component)
- Modify: `frontend/src/app/dashboard/campaigns/[id]/page.tsx` (rerun binding transfer, ~line 400)

**Interfaces:**
- Consumes: Task 6 library; `GET /api/backend/campaigns/{id}/resume-manifest`; `POST /api/backend/campaigns/{id}/resumes`.
- Produces: background polling while any app page is open; permission-regrant banner; binding transfer on rerun.

- [ ] **Step 1: Implement `folder-watcher.tsx`**

```tsx
"use client";

// Background folder watcher. Mounted once app-wide; renders nothing unless a
// binding needs a permission re-grant (banner) or files were rejected (toastish
// warning). All state is per-tab; the server manifest is the source of truth,
// so duplicate uploads across tabs are hash-deduped server-side.

import { useEffect, useRef, useState } from "react";

import {
  fileKey,
  getBindings,
  hashFile,
  listResumeFiles,
  removeBinding,
} from "@/lib/folder-watch";

const TICK_MS = 15_000;

type PendingGrant = { campaignId: number; folderName: string };

export function FolderWatcher() {
  const [pendingGrants, setPendingGrants] = useState<PendingGrant[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // name|size|mtime seen last tick — a file must be stable across two ticks
  const prevTick = useRef<Set<string>>(new Set());
  // keys already uploaded or already on the server
  const handled = useRef<Set<string>>(new Set());
  // keys rejected by the server (422) — never retried
  const rejected = useRef<Set<string>>(new Set());
  const busy = useRef(false);

  useEffect(() => {
    async function tick() {
      if (busy.current) return;
      busy.current = true;
      try {
        const bindings = await getBindings();
        const needsGrant: PendingGrant[] = [];
        for (const { campaignId, handle } of bindings) {
          const perm = await handle.queryPermission({ mode: "read" });
          if (perm !== "granted") {
            needsGrant.push({ campaignId, folderName: handle.name });
            continue;
          }
          await syncCampaign(campaignId, handle);
        }
        setPendingGrants(needsGrant);
      } catch {
        // offline or transient failure — try again next tick
      } finally {
        busy.current = false;
      }
    }

    async function syncCampaign(
      campaignId: number,
      handle: FileSystemDirectoryHandle,
    ) {
      const files = await listResumeFiles(handle);
      const thisTick = new Set(files.map(fileKey));
      const candidates = files.filter((f) => {
        const key = fileKey(f);
        return (
          !handled.current.has(key) &&
          !rejected.current.has(key) &&
          prevTick.current.has(key) // stable across two ticks (not mid-download)
        );
      });
      prevTick.current = new Set([...prevTick.current, ...thisTick]);
      if (candidates.length === 0) return;

      const manifestRes = await fetch(
        `/api/backend/campaigns/${campaignId}/resume-manifest`,
      );
      if (manifestRes.status === 404) {
        await removeBinding(campaignId); // campaign deleted — stop watching
        return;
      }
      if (!manifestRes.ok) return;
      const manifest: { resumes: { content_hash: string | null }[] } =
        await manifestRes.json();
      const serverHashes = new Set(
        manifest.resumes.map((r) => r.content_hash).filter(Boolean),
      );

      const fresh: File[] = [];
      for (const f of candidates) {
        if (serverHashes.has(await hashFile(f))) {
          handled.current.add(fileKey(f)); // already uploaded earlier
        } else {
          fresh.push(f);
        }
      }
      if (fresh.length === 0) return;

      const fd = new FormData();
      fresh.forEach((f) => fd.append("resume_files", f));
      const res = await fetch(`/api/backend/campaigns/${campaignId}/resumes`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        fresh.forEach((f) => handled.current.add(fileKey(f)));
      } else if (res.status === 422) {
        // batch may mix valid/invalid; retry one-by-one so good files pass
        for (const f of fresh) {
          const single = new FormData();
          single.append("resume_files", f);
          const r = await fetch(`/api/backend/campaigns/${campaignId}/resumes`, {
            method: "POST",
            body: single,
          });
          if (r.ok) {
            handled.current.add(fileKey(f));
          } else if (r.status === 422) {
            rejected.current.add(fileKey(f));
            const detail = await r.json().catch(() => ({ detail: "" }));
            setWarnings((w) => [
              ...w.slice(-4),
              `${f.name}: ${typeof detail.detail === "string" ? detail.detail : "rejected"}`,
            ]);
          }
        }
      }
    }

    void tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  async function grant(campaignId: number) {
    const bindings = await getBindings();
    const b = bindings.find((x) => x.campaignId === campaignId);
    if (!b) return;
    await b.handle.requestPermission({ mode: "read" }); // needs this user gesture
    setPendingGrants((p) => p.filter((x) => x.campaignId !== campaignId));
  }

  if (pendingGrants.length === 0 && warnings.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {pendingGrants.map((p) => (
        <div
          key={p.campaignId}
          className="rounded-lg border bg-background p-3 text-sm shadow-lg"
        >
          <p className="font-medium">Folder watching paused</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Campaign #{p.campaignId} — “{p.folderName}”. Browsers require a
            click to re-allow folder access after a restart.
          </p>
          <button
            className="mt-2 text-xs font-medium underline"
            onClick={() => void grant(p.campaignId)}
          >
            Resume watching
          </button>
        </div>
      ))}
      {warnings.map((w, i) => (
        <div
          key={i}
          className="rounded-lg border bg-background p-3 text-xs text-amber-700 shadow-lg"
        >
          Skipped file — {w}
          <button
            className="ml-2 underline"
            onClick={() => setWarnings((x) => x.filter((_, j) => j !== i))}
          >
            dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
```

TS note: `queryPermission`/`requestPermission` may need interface augmentation in `folder-watch.ts`:

```typescript
declare global {
  interface FileSystemDirectoryHandle {
    queryPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  }
}
```

(then call with optional chaining and treat `undefined` as `"granted"` — Chromium always implements these).

- [ ] **Step 2: Mount in `providers.tsx`**

Render `<FolderWatcher />` alongside existing providers' children (it no-ops with zero bindings; on login page there are no bindings, so no API traffic).

- [ ] **Step 3: Rerun binding transfer**

In `app/dashboard/campaigns/[id]/page.tsx`, in the `rerun` mutation's success path (it receives `{ campaign_id }` of the clone), add:

```typescript
import { moveBinding } from "@/lib/folder-watch";
// in onSuccess (or after mutateAsync resolves), before navigation:
await moveBinding(Number(id), data.campaign_id);
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npm run lint` — Expected: clean.
Manual (Chrome, both dev servers running): create a folder-mode campaign on an empty folder → drop a `.txt` resume in → within ~30 s a candidate appears and the campaign goes Queued → Processing → Completed. Drop the same file again → nothing happens (hash dedup). Restart browser → banner appears → click → watching resumes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/folder-watcher.tsx frontend/src/app/providers.tsx "frontend/src/app/dashboard/campaigns/[id]/page.tsx" frontend/src/lib/folder-watch.ts
git commit -m "feat: background folder watcher with permission banner and rerun transfer"
```

---

### Task 9: Watching status in dashboard UI

**Files:**
- Modify: `frontend/src/app/dashboard/page.tsx` (STATUS_STYLE map, ~line 86)
- Modify: `frontend/src/app/dashboard/campaigns/[id]/page.tsx` (status display, folder badge)

**Interfaces:**
- Consumes: `Campaign.status === "Watching"`, `intake_mode`/`folder_name` (already serialized — list/detail endpoints return ORM objects).

- [ ] **Step 1: Add styles/labels**

In `dashboard/page.tsx`, add a `Watching` entry to `STATUS_STYLE` (match the map's existing shape — e.g. a sky/blue variant distinct from Queued). In the campaign detail page header, when `intake_mode === "folder"`, render a muted line: `📁 Watching “{folder_name}” — new resumes in this folder are screened automatically while the app is open.`; when status is `Watching`, subtitle "Waiting for the first resumes to appear in the folder."

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`. Manual: dashboard list shows the Watching badge for an empty folder campaign.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/dashboard/page.tsx "frontend/src/app/dashboard/campaigns/[id]/page.tsx"
git commit -m "feat: Watching status and folder badge in dashboard UI"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Full backend suite** — `uv run pytest -q` → all pass.
- [ ] **Step 2: Frontend** — `npx tsc --noEmit`, `npm run lint`, `npm run build` → clean.
- [ ] **Step 3: Manual E2E in Chrome** (both dev servers):
  1. Manual-upload campaign still works end-to-end (regression).
  2. Folder campaign, empty folder → `Watching`; add 2 resumes → one incremental run screens both; scores/outreach drafts appear.
  3. Add 1 more resume → screened alone; existing candidates' scores unchanged (compare before/after).
  4. Two campaigns, drop one resume in each folder within seconds → both process serially, both complete.
  5. Duplicate file content, different name → skipped.
  6. A `.png` in the folder → ignored client-side (extension filter), no warning spam.
- [ ] **Step 4: Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch.**
