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
