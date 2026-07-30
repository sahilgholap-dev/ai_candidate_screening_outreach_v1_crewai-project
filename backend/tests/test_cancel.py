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
        cid = create_campaign_fn(
            intake_mode="folder", resumes=(), folder_name="F"
        ).json()["campaign_id"]
        _set_status(cid, initial)
        r = client.post(f"/api/campaigns/{cid}/cancel", headers=company_auth)
        assert r.status_code == 200 and r.json()["status"] == "Cancelled"


def test_cancel_processing(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("cp.txt", b"x"),)).json()["campaign_id"]
    _set_status(cid, "Processing")
    r = client.post(f"/api/campaigns/{cid}/cancel", headers=company_auth)
    assert r.status_code == 200 and r.json()["status"] == "Cancelled"


def test_cancel_completed_conflicts(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("c1.txt", b"x"),)).json()["campaign_id"]
    _set_status(cid, "Completed")
    assert client.post(f"/api/campaigns/{cid}/cancel", headers=company_auth).status_code == 409


def test_add_resumes_to_cancelled_conflicts(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("c2.txt", b"x"),)).json()["campaign_id"]
    _set_status(cid, "Cancelled")
    r = client.post(
        f"/api/campaigns/{cid}/resumes",
        files=[("resume_files", ("n.txt", b"y", "text/plain"))],
        headers=company_auth,
    )
    assert r.status_code == 409
