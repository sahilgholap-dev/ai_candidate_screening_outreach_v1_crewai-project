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
