import os
from typing import List
from fastapi import WebSocket, WebSocketDisconnect, Query
import asyncio
import threading
from queue import Queue, Empty

import jwt
from fastapi import (
    BackgroundTasks,
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
from ai_candidate_screening_outreach.auth.deps import require_company_user
from ai_candidate_screening_outreach.auth.routes import router as auth_router
from ai_candidate_screening_outreach.auth.security import decode_access_token
from ai_candidate_screening_outreach.db.database import engine, Base, get_db, SessionLocal
from ai_candidate_screening_outreach.db.models import Campaign, Candidate, Company, User
from ai_candidate_screening_outreach.schemas.requirements import RequirementsProfileV1
from ai_candidate_screening_outreach.main import run_campaign_task
from ai_candidate_screening_outreach.utils.indeed_scraper import IndeedDownloader

# Create tables missing on fresh DBs; schema evolution is Alembic's job
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Candidate Screening API")

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
        "allow_gender_eligibility": company.allow_gender_eligibility,
        "office_locations": company.office_locations or [],
    }


@app.get("/api/campaigns")
async def list_campaigns(
    user: User = Depends(require_company_user), db: Session = Depends(get_db)
):
    return _campaign_query(db, user).order_by(Campaign.id.desc()).all()


@app.post("/api/campaigns")
async def create_campaign(
    background_tasks: BackgroundTasks,
    campaign_name: str = Form(...),
    threshold: float = Form(65.0),
    region: str | None = Form(None),
    requirements: str | None = Form(None),  # JSON-encoded RequirementsProfileV1
    jd_file: UploadFile = File(...),
    resume_files: List[UploadFile] = File(...),
    user: User = Depends(require_company_user),
    db: Session = Depends(get_db),
):
    if user.role == "platform_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Campaigns are created by company users",
        )

    company = db.query(Company).filter(Company.id == user.company_id).first()

    # Validate the requirements profile, if provided
    requirements_data = None
    if requirements:
        try:
            profile = RequirementsProfileV1.model_validate_json(requirements)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"Invalid requirements: {e}")
        # Gender eligibility is admin-gated per company and always justified
        if profile.gender_eligibility != "any" and not (
            company and company.allow_gender_eligibility
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Gender-restricted campaigns are not enabled for this company",
            )
        requirements_data = profile.model_dump(mode="json")

    campaign_region = (region or (company.default_region if company else "IN")).upper()
    if campaign_region not in {"US", "UK", "IN"}:
        raise HTTPException(status_code=422, detail="region must be US, UK or IN")

    new_campaign = Campaign(
        name=campaign_name,
        company_id=user.company_id,
        created_by=user.id,
        region=campaign_region,
        threshold=threshold,
        requirements=requirements_data,
        jd_text="",  # parsed in background
        status="Processing",
    )
    db.add(new_campaign)
    db.commit()
    db.refresh(new_campaign)

    upload_dir = os.path.join(BASE_DIR, "uploads", f"campaign_{new_campaign.id}")
    os.makedirs(upload_dir, exist_ok=True)

    jd_bytes = await jd_file.read()
    jd_path = os.path.join(upload_dir, f"JD_{os.path.basename(jd_file.filename)}")
    with open(jd_path, "wb") as f:
        f.write(jd_bytes)

    for r_file in resume_files:
        r_bytes = await r_file.read()
        safe_name = os.path.basename(r_file.filename)
        file_path = os.path.join(upload_dir, safe_name)
        with open(file_path, "wb") as f:
            f.write(r_bytes)

        db.add(
            Candidate(
                campaign_id=new_campaign.id,
                original_filename=safe_name,
                parsed_text="",  # parsed by background task
            )
        )

    db.commit()

    background_tasks.add_task(run_campaign_task, new_campaign.id, upload_dir, jd_path)

    return {"success": True, "campaign_id": new_campaign.id}


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
