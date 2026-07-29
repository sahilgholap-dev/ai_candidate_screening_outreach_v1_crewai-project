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


def test_jd_and_resumes_parsed_at_creation(create_campaign_fn):
    """Any worker (local or Railway) must be able to run the campaign, so
    text extraction happens at upload time, not run time."""
    res = create_campaign_fn(resumes=(("a.txt", b"python developer resume"),))
    campaign_id = res.json()["campaign_id"]
    db = SessionLocal()
    try:
        c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        assert "job description" in c.jd_text
        cand = db.query(Candidate).filter(Candidate.campaign_id == campaign_id).first()
        assert cand.parsed_text == "python developer resume"
    finally:
        db.close()
