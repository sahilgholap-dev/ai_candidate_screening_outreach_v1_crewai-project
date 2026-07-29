import csv
import hashlib
import io
import json
import os
from typing import List
from fastapi import WebSocket, WebSocketDisconnect, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import threading
from queue import Queue, Empty

from contextlib import asynccontextmanager

import jwt
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from ai_candidate_screening_outreach.admin.routes import router as admin_router
from ai_candidate_screening_outreach.audit import log_action
from ai_candidate_screening_outreach.auth.deps import require_company_user
from ai_candidate_screening_outreach.auth.routes import router as auth_router
from ai_candidate_screening_outreach.auth.security import decode_access_token
from ai_candidate_screening_outreach.db.database import engine, Base, get_db, SessionLocal
from ai_candidate_screening_outreach.db.models import Campaign, Candidate, Company, User
from ai_candidate_screening_outreach.schemas.requirements import RequirementsProfileV1
from ai_candidate_screening_outreach.pipeline.queue_worker import (
    enqueue_campaign,
    requeue_stuck_campaigns,
    start_worker,
)
from ai_candidate_screening_outreach.utils.indeed_scraper import IndeedDownloader

# Create tables missing on fresh DBs; schema evolution is Alembic's job
Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    requeued = requeue_stuck_campaigns()
    if requeued:
        print(f"[queue] re-queued {requeued} campaign(s) stuck in Processing")
    start_worker()
    yield


app = FastAPI(title="AI Candidate Screening API", lifespan=lifespan)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(admin_router)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file
MAX_RESUMES_PER_CAMPAIGN = 200


def _validate_upload(filename: str | None, data: bytes, kind: str) -> str:
    """Returns a sanitized filename or raises 422."""
    safe_name = os.path.basename(filename or "")
    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"{kind} '{safe_name}': only PDF, DOCX and TXT files are accepted",
        )
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"{kind} '{safe_name}' exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
        )
    if not data:
        raise HTTPException(status_code=422, detail=f"{kind} '{safe_name}' is empty")
    return safe_name


def _campaign_query(db: Session, user: User):
    """All campaigns visible to this user: their company's, or all for admins."""
    q = db.query(Campaign)
    if user.role != "platform_admin":
        q = q.filter(Campaign.company_id == user.company_id)
    return q


@app.get("/api/my/company")
async def my_company(
    user: User = Depends(require_company_user), db: Session = Depends(get_db)
):
    """Company profile for the logged-in company user (drives form gating)."""
    if user.role == "platform_admin":
        raise HTTPException(status_code=400, detail="Admins are not linked to a company")
    company = db.query(Company).filter(Company.id == user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return {
        "id": company.id,
        "name": company.name,
        "default_region": company.default_region,
        "default_threshold": company.default_threshold,
        "office_locations": company.office_locations or [],
    }


@app.get("/api/campaigns")
async def list_campaigns(
    user: User = Depends(require_company_user), db: Session = Depends(get_db)
):
    return _campaign_query(db, user).order_by(Campaign.id.desc()).all()


@app.post("/api/campaigns")
async def create_campaign(
    campaign_name: str = Form(...),
    threshold: float = Form(65.0),
    region: str | None = Form(None),
    requirements: str | None = Form(None),  # JSON-encoded RequirementsProfileV1
    jd_file: UploadFile = File(...),
    resume_files: List[UploadFile] = File(default=[]),
    intake_mode: str = Form("upload"),
    folder_name: str | None = Form(None),
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    if user.role == "platform_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Campaigns are created by company users",
        )

    if intake_mode not in {"upload", "folder"}:
        raise HTTPException(
            status_code=422, detail="intake_mode must be 'upload' or 'folder'"
        )
    if intake_mode == "upload" and not resume_files:
        raise HTTPException(status_code=422, detail="Upload at least one resume")

    if len(resume_files) > MAX_RESUMES_PER_CAMPAIGN:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_RESUMES_PER_CAMPAIGN} resumes per campaign",
        )

    company = db.query(Company).filter(Company.id == user.company_id).first()

    # Validate the requirements profile, if provided
    requirements_data = None
    if requirements:
        try:
            profile = RequirementsProfileV1.model_validate_json(requirements)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"Invalid requirements: {e}")
        requirements_data = profile.model_dump(mode="json")

    campaign_region = (region or (company.default_region if company else "IN")).upper()
    if campaign_region not in {"US", "UK", "IN"}:
        raise HTTPException(status_code=422, detail="region must be US, UK or IN")

    # Read + validate every file BEFORE creating any DB rows, so a rejected
    # upload never leaves an orphaned queued campaign behind.
    jd_bytes = await jd_file.read()
    jd_name = _validate_upload(jd_file.filename, jd_bytes, "Job description")
    validated_resumes: list[tuple[str, bytes]] = []
    for r_file in resume_files:
        r_bytes = await r_file.read()
        safe_name = _validate_upload(r_file.filename, r_bytes, "Resume")
        validated_resumes.append((safe_name, r_bytes))

    new_campaign = Campaign(
        name=campaign_name,
        company_id=user.company_id,
        created_by=user.id,
        region=campaign_region,
        threshold=threshold,
        requirements=requirements_data,
        jd_text="",  # parsed in background
        intake_mode=intake_mode,
        folder_name=folder_name,
        status="Watching" if intake_mode == "folder" and not validated_resumes else "Queued",
    )
    db.add(new_campaign)
    db.commit()
    db.refresh(new_campaign)

    upload_dir = os.path.join(BASE_DIR, "uploads", f"campaign_{new_campaign.id}")
    os.makedirs(upload_dir, exist_ok=True)

    jd_path = os.path.join(upload_dir, f"JD_{jd_name}")
    with open(jd_path, "wb") as f:
        f.write(jd_bytes)

    for safe_name, r_bytes in validated_resumes:
        file_path = os.path.join(upload_dir, safe_name)
        with open(file_path, "wb") as f:
            f.write(r_bytes)

        db.add(
            Candidate(
                campaign_id=new_campaign.id,
                original_filename=safe_name,
                parsed_text="",  # parsed by background task
                content_hash=hashlib.sha256(r_bytes).hexdigest(),
            )
        )

    log_action(
        db,
        "campaign.created",
        user=user,
        detail={
            "campaign_id": new_campaign.id,
            "name": new_campaign.name,
            "region": new_campaign.region,
            "resumes": len(resume_files),
            "intake_mode": intake_mode,
        },
    )
    db.commit()

    if validated_resumes:
        enqueue_campaign(db, new_campaign)

    return {"success": True, "campaign_id": new_campaign.id}


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


@app.post("/api/delete-campaigns")
async def delete_campaigns(
    request: Request,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    try:
        data = await request.json()
        campaign_ids = [int(cid) for cid in data.get("campaign_ids", [])]
    except Exception:
        campaign_ids = []
    if campaign_ids:
        campaigns = _campaign_query(db, user).filter(Campaign.id.in_(campaign_ids)).all()
        for campaign in campaigns:
            log_action(
                db,
                "campaign.deleted",
                user=user,
                company_id=campaign.company_id,
                detail={"campaign_id": campaign.id, "name": campaign.name},
            )
            db.delete(campaign)  # candidates removed via cascade
        db.commit()
    return {"success": True}


@app.get("/api/campaigns/{campaign_id}")
async def view_campaign(
    campaign_id: int,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    candidates = db.query(Candidate).filter(Candidate.campaign_id == campaign.id).all()

    processed_count = sum(1 for c in candidates if c.score is not None)
    total_count = len(candidates)

    candidates = sorted(
        candidates, key=lambda x: x.score if x.score is not None else -1, reverse=True
    )
    return {
        "campaign": campaign,
        "candidates": candidates,
        "processed_count": processed_count,
        "total_count": total_count,
    }


@app.post("/api/campaigns/{campaign_id}/retry")
async def retry_campaign(
    campaign_id: int,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    """Re-queue a failed campaign. Resume text and JD are already stored on the
    rows, so the pipeline re-runs even if the original upload files are gone."""
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status != "Error":
        raise HTTPException(
            status_code=409,
            detail=f"Only failed campaigns can be re-run (status is {campaign.status})",
        )
    campaign.status = "Queued"
    campaign.error_message = None
    campaign.finished_at = None
    log_action(
        db,
        "campaign.retried",
        user=user,
        company_id=campaign.company_id,
        detail={"campaign_id": campaign.id, "name": campaign.name},
    )
    db.commit()
    return {"success": True, "campaign_id": campaign.id, "status": "Queued"}


@app.post("/api/campaigns/{campaign_id}/rerun")
async def rerun_campaign(
    campaign_id: int,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    """Clone a finished campaign (same JD, requirements, and parsed resumes)
    and queue the copy — the original's results stay untouched so runs can be
    compared side by side. No re-upload needed: parsed text lives on the rows."""
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status not in ("Completed", "Error"):
        raise HTTPException(
            status_code=409,
            detail=f"Only finished campaigns can be re-run (status is {campaign.status})",
        )
    candidates = (
        db.query(Candidate).filter(Candidate.campaign_id == campaign.id).all()
    )
    if not any(c.parsed_text for c in candidates):
        raise HTTPException(
            status_code=409,
            detail="No parsed resume text is stored for this campaign (data may have been purged)",
        )

    prior_runs = (
        _campaign_query(db, user)
        .filter(Campaign.name.like(f"{campaign.name.split(' (run ')[0]} (run %"))
        .count()
    )
    base_name = campaign.name.split(" (run ")[0]
    clone = Campaign(
        name=f"{base_name} (run {prior_runs + 2})",
        company_id=campaign.company_id,
        created_by=user.id,
        region=campaign.region,
        threshold=campaign.threshold,
        requirements=campaign.requirements,
        unified_profile=campaign.unified_profile,  # same checklist across reruns
        jd_text=campaign.jd_text,
        status="Queued",
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)

    for c in candidates:
        if c.parsed_text:
            db.add(
                Candidate(
                    campaign_id=clone.id,
                    original_filename=c.original_filename,
                    parsed_text=c.parsed_text,
                )
            )
    log_action(
        db,
        "campaign.rerun",
        user=user,
        company_id=campaign.company_id,
        detail={
            "source_campaign_id": campaign.id,
            "new_campaign_id": clone.id,
            "name": clone.name,
        },
    )
    db.commit()
    enqueue_campaign(db, clone)
    return {"success": True, "campaign_id": clone.id, "status": "Queued"}


class CandidateUpdate(BaseModel):
    email_draft: str | None = None
    sms_draft: str | None = None
    outreach_approved: bool | None = None


@app.patch("/api/campaigns/{campaign_id}/candidates/{candidate_id}")
async def update_candidate(
    campaign_id: int,
    candidate_id: int,
    body: CandidateUpdate,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    candidate = (
        db.query(Candidate)
        .filter(Candidate.id == candidate_id, Candidate.campaign_id == campaign.id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(candidate, key, value)
    if "outreach_approved" in changes:
        log_action(
            db,
            "outreach.approved" if changes["outreach_approved"] else "outreach.approval_withdrawn",
            user=user,
            company_id=campaign.company_id,
            detail={"campaign_id": campaign.id, "candidate_id": candidate.id, "candidate": candidate.name},
        )
    db.commit()
    db.refresh(candidate)
    return candidate


def _json_list(value: str | None) -> str:
    if not value:
        return ""
    try:
        items = json.loads(value)
        return "; ".join(items) if isinstance(items, list) else str(items)
    except (ValueError, TypeError):
        return value


@app.get("/api/campaigns/{campaign_id}/export.csv")
async def export_campaign_csv(
    campaign_id: int,
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    campaign = _campaign_query(db, user).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    candidates = (
        db.query(Candidate)
        .filter(Candidate.campaign_id == campaign.id)
        .order_by(Candidate.score.desc().nullslast())
        .all()
    )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Rank", "Name", "File", "Score", "Recommendation", "Hard Filter Failed",
            "Needs Info", "Flags", "Key Strengths", "Key Gaps", "Rationale",
            "Email Draft", "SMS Draft", "Outreach Approved",
        ]
    )
    for rank, c in enumerate(candidates, start=1):
        writer.writerow(
            [
                rank, c.name or "", c.original_filename or "",
                c.score if c.score is not None else "",
                c.recommendation or "", "Y" if c.hard_filter_failed else "N",
                _json_list(c.needs_info), _json_list(c.flags),
                _json_list(c.key_strengths), _json_list(c.key_gaps),
                c.rationale or "", c.email_draft or "", c.sms_draft or "",
                "Y" if c.outreach_approved else "N",
            ]
        )
    buf.seek(0)
    safe_name = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in campaign.name or "campaign")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}_candidates.csv"'
        },
    )


@app.websocket("/ws/scraper")
async def websocket_scraper(
    websocket: WebSocket,
    token: str = Query(...),
    mode: str = Query("backend"),
    job_mode: str = Query("single"),
    job_status: str = Query("ACTIVE"),
):
    # Admin-only. Browsers can't set Authorization headers on WebSockets,
    # so the JWT arrives as a query parameter.
    try:
        user_id = decode_access_token(token)
    except jwt.PyJWTError:
        await websocket.close(code=4401)
        return
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
    finally:
        db.close()
    if not user or user.role != "platform_admin":
        await websocket.close(code=4403)
        return

    await websocket.accept()

    log_queue = Queue()
    interaction_event = threading.Event()
    interaction_data = {}

    def run_scraper_thread():
        try:
            statuses = job_status.split(",")
            downloader = IndeedDownloader(
                mode=mode,
                job_mode=job_mode,
                job_statuses=statuses,
                log_queue=log_queue,
                interaction_event=interaction_event,
                interaction_data=interaction_data,
            )
            downloader.run()
        except Exception as e:
            log_queue.put({"type": "log", "message": f"ERROR: {str(e)}"})
        finally:
            log_queue.put({"type": "finished"})

    thread = threading.Thread(target=run_scraper_thread)
    thread.start()

    async def read_from_ws():
        try:
            while True:
                data = await websocket.receive_json()
                if data.get("action") == "continue":
                    interaction_data["value"] = data.get("value", "")
                    interaction_event.set()
        except WebSocketDisconnect:
            pass

    async def write_to_ws():
        try:
            while True:
                try:
                    msg = log_queue.get(timeout=0.1)
                    await websocket.send_json(msg)
                    if msg.get("type") == "finished":
                        break
                except Empty:
                    await asyncio.sleep(0.1)
                    if websocket.client_state.value == 3:  # DISCONNECTED
                        break
        except Exception:
            pass

    await asyncio.gather(read_from_ws(), write_to_ws())
