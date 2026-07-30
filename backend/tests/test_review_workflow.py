"""Review workflow: approve -> queue -> send record -> sent list."""

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
    return client.patch(
        f"/api/campaigns/{cid}/candidates/{cand_id}", json=body, headers=auth
    )


def test_approve_puts_candidate_in_queue(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q1.txt", b"email: q1@x.com"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid, parsed_text="Contact email: q1@x.com")
    r = _patch(client, company_auth, cid, cand_id, review_status="approved")
    assert r.status_code == 200
    queue = client.get("/api/outreach/queue", headers=company_auth).json()
    entry = next(e for e in queue if e["candidate_id"] == cand_id)
    assert entry["band"] == "ideal" and entry["email"] == "q1@x.com"


def test_invalid_review_status_rejected(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q2.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    r = _patch(client, company_auth, cid, cand_id, review_status="maybe-later")
    assert r.status_code == 422


def test_send_requires_approval(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q3.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    r = client.post(
        f"/api/campaigns/{cid}/candidates/{cand_id}/send",
        json={"email_body": "Hello"},
        headers=company_auth,
    )
    assert r.status_code == 409


def test_send_blocks_placeholders(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q4.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    _patch(client, company_auth, cid, cand_id, review_status="approved")
    r = client.post(
        f"/api/campaigns/{cid}/candidates/{cand_id}/send",
        json={"email_body": "Dear [Candidate], join [Company]"},
        headers=company_auth,
    )
    assert r.status_code == 422


def test_send_records_and_moves_to_sent(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("q5.txt", b"x"),)).json()["campaign_id"]
    cand_id = _score_candidate(cid)
    _patch(client, company_auth, cid, cand_id, review_status="approved")
    r = client.post(
        f"/api/campaigns/{cid}/candidates/{cand_id}/send",
        json={"email_body": "Hello there", "sms_body": "hi"},
        headers=company_auth,
    )
    assert r.status_code == 200 and r.json()["sent_at"]
    # second send is a conflict
    r2 = client.post(
        f"/api/campaigns/{cid}/candidates/{cand_id}/send",
        json={"email_body": "Hello again"},
        headers=company_auth,
    )
    assert r2.status_code == 409
    queue = client.get("/api/outreach/queue", headers=company_auth).json()
    assert all(e["candidate_id"] != cand_id for e in queue)
    sent = client.get("/api/outreach/sent", headers=company_auth).json()
    assert any(
        s["candidate_id"] == cand_id and s["sent_by"] == "user@testco.example"
        for s in sent
    )
