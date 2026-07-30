"""Band mapping is the front-of-house language for scores."""

from ai_candidate_screening_outreach.bands import band_for


def test_any_shortlist_is_ideal():
    assert band_for("Shortlist", 85, False, 65) == "ideal"
    assert band_for("Shortlist", 66, False, 65) == "ideal"


def test_maybe_is_good():
    assert band_for("Maybe", 60, False, 65) == "good"


def test_rejects_hard_filter_duplicate_needs_review_are_not_fit():
    for rec in ["Reject", "Reject (Hard Filter)", "Duplicate", "Needs Review"]:
        assert band_for(rec, 10, False, 65) == "not_fit"
    assert band_for("Shortlist", 90, True, 65) == "not_fit"


def test_unscored_is_unscored():
    assert band_for(None, None, False, 65) == "unscored"


def test_campaign_list_has_counts(client, company_auth, create_campaign_fn):
    cid = create_campaign_fn(resumes=(("a.txt", b"x"),)).json()["campaign_id"]
    rows = client.get("/api/campaigns", headers=company_auth).json()
    row = next(r for r in rows if r["id"] == cid)
    assert row["counts"]["total"] == 1
    assert row["counts"]["processed"] == 0
    assert "role_title" in row and "urgency" in row


def test_view_campaign_candidates_have_band(client, company_auth, create_campaign_fn):
    from ai_candidate_screening_outreach.db.database import SessionLocal
    from ai_candidate_screening_outreach.db.models import Candidate

    cid = create_campaign_fn(resumes=(("b.txt", b"x"),)).json()["campaign_id"]
    db = SessionLocal()
    try:
        cand = db.query(Candidate).filter(Candidate.campaign_id == cid).first()
        cand.score = 90
        cand.recommendation = "Shortlist"
        db.commit()
    finally:
        db.close()
    detail = client.get(f"/api/campaigns/{cid}", headers=company_auth).json()
    assert detail["candidates"][0]["band"] == "ideal"
