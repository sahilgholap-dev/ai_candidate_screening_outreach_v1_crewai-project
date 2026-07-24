import os
from typing import List
from fastapi import WebSocket, WebSocketDisconnect, Query
import asyncio
import threading
from queue import Queue, Empty
from typing import Optional
from ai_candidate_screening_outreach.utils.indeed_scraper import IndeedDownloader
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, Request, Depends



from sqlalchemy.orm import Session

from ai_candidate_screening_outreach.db.database import engine, Base, get_db
from ai_candidate_screening_outreach.db.models import Campaign, Candidate
from ai_candidate_screening_outreach.utils.parser import extract_text_from_pdf, extract_text_from_docx
from ai_candidate_screening_outreach.main import run_campaign_task

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Candidate Screening API")
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get the directory of this file to properly mount static and templates
BASE_DIR = os.path.dirname(os.path.abspath(__file__))




@app.get("/api/campaigns")
async def list_campaigns(db: Session = Depends(get_db)):
    return db.query(Campaign).order_by(Campaign.id.desc()).all()

@app.post("/api/campaigns")
async def create_campaign(
    background_tasks: BackgroundTasks,
    campaign_name: str = Form(...),
    threshold: float = Form(65.0),
    jd_file: UploadFile = File(...),
    resume_files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    # Create Campaign
    new_campaign = Campaign(
        name=campaign_name,
        threshold=threshold,
        jd_text="", # Will be parsed in background
        status="Processing"
    )
    db.add(new_campaign)
    db.commit()
    db.refresh(new_campaign)

    # Save files to disk for background processing
    upload_dir = os.path.join(BASE_DIR, "uploads", f"campaign_{new_campaign.id}")
    os.makedirs(upload_dir, exist_ok=True)
    
    # Save JD
    jd_bytes = await jd_file.read()
    jd_path = os.path.join(upload_dir, f"JD_{jd_file.filename}")
    with open(jd_path, "wb") as f:
        f.write(jd_bytes)

    # Save Resumes and create empty Candidate records
    for r_file in resume_files:
        r_bytes = await r_file.read()
        file_path = os.path.join(upload_dir, r_file.filename)
        with open(file_path, "wb") as f:
            f.write(r_bytes)
            
        new_candidate = Candidate(
            campaign_id=new_campaign.id,
            original_filename=r_file.filename,
            parsed_text="" # Will be parsed by background task
        )
        db.add(new_candidate)
    
    db.commit()

    # Launch CrewAI in background
    background_tasks.add_task(run_campaign_task, new_campaign.id, upload_dir, jd_path)

    return {"success": True, "campaign_id": new_campaign.id}

@app.post("/api/clear-db")
async def clear_db(db: Session = Depends(get_db)):
    db.query(Candidate).delete()
    db.query(Campaign).delete()
    db.commit()
    return {"success": True}

@app.post("/api/delete-campaigns")
async def delete_campaigns(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        campaign_ids = data.get("campaign_ids", [])
    except Exception:
        campaign_ids = []
    if campaign_ids:
        for cid in campaign_ids:
            try:
                campaign_id = int(cid)
                db.query(Candidate).filter(Candidate.campaign_id == campaign_id).delete()
                db.query(Campaign).filter(Campaign.id == campaign_id).delete()
            except ValueError:
                pass
        db.commit()
    return {"success": True}

@app.get("/api/campaigns/{campaign_id}")
async def view_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    candidates = db.query(Candidate).filter(Candidate.campaign_id == campaign_id).all()
    
    processed_count = sum(1 for c in candidates if c.score is not None)
    total_count = len(candidates)
    
    candidates = sorted(candidates, key=lambda x: x.score if x.score is not None else -1, reverse=True)
    return {
        "campaign": campaign,
        "candidates": candidates,
        "processed_count": processed_count,
        "total_count": total_count
    }




@app.websocket("/ws/scraper")
async def websocket_scraper(
    websocket: WebSocket,
    mode: str = Query("backend"),
    job_mode: str = Query("single"),
    job_status: str = Query("ACTIVE")
):
    await websocket.accept()
    
    log_queue = Queue()
    interaction_event = threading.Event()
    interaction_data = {}
    
    # Run the scraper in a background thread
    def run_scraper_thread():
        try:
            statuses = job_status.split(",")
            downloader = IndeedDownloader(
                mode=mode, 
                job_mode=job_mode, 
                job_statuses=statuses,
                log_queue=log_queue,
                interaction_event=interaction_event,
                interaction_data=interaction_data
            )
            downloader.run()
        except Exception as e:
            log_queue.put({"type": "log", "message": f"ERROR: {str(e)}"})
        finally:
            log_queue.put({"type": "finished"})

    thread = threading.Thread(target=run_scraper_thread)
    thread.start()
    
    # We need a task to read from websocket and a task to write to websocket
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
                    # Non-blocking get with small timeout to allow context switch
                    msg = log_queue.get(timeout=0.1)
                    await websocket.send_json(msg)
                    if msg.get("type") == "finished":
                        break
                except Empty:
                    await asyncio.sleep(0.1)
                    
                    # Also check if WS is closed
                    if websocket.client_state.value == 3: # DISCONNECTED
                        break
        except Exception:
            pass

    await asyncio.gather(
        read_from_ws(),
        write_to_ws()
    )
