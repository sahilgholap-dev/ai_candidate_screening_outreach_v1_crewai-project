"""compute_score turns the evaluator's binary judgments into the 0-100 score.
All arithmetic lives here (deterministic), never in the LLM."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_candidate_screening_outreach.db.models import (
    CandidateEvaluation,
    MustHaveJudgment,
    SkillJudgment,
    UnifiedRequirements,
)
from ai_candidate_screening_outreach.pipeline.scoring import compute_score
from ai_candidate_screening_outreach.schemas.requirements import CustomWeights

# default weights: required 40 / must-haves 20 / experience 20 / education 10 / preferred 10
WEIGHTS = CustomWeights(
    required_skills=40, must_haves=20, experience=20, education=10, preferred_skills=10
)


def _ev(**overrides) -> CandidateEvaluation:
    base = dict(
        candidate_id=1,
        name="Test Candidate",
        hard_filter_failed=False,
        key_strengths=[],
        key_gaps=[],
        rationale="",
    )
    base.update(overrides)
    return CandidateEvaluation(**base)


def _profile(**overrides) -> UnifiedRequirements:
    base = dict(summary="Role.")
    base.update(overrides)
    return UnifiedRequirements(**base)


def test_everything_present_scores_100():
    ev = _ev(
        required_skill_judgments=[SkillJudgment(skill="A", present=True)],
        preferred_skill_judgments=[SkillJudgment(skill="B", present=True)],
        must_have_judgments=[MustHaveJudgment(item="onsite", status="met")],
        estimated_total_years=3.0,
    )
    profile = _profile(min_years_experience="2")
    assert compute_score(ev, WEIGHTS, profile) == 100


def test_required_skills_scale_proportionally():
    ev = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="A", present=True),
            SkillJudgment(skill="B", present=True),
            SkillJudgment(skill="C", present=False),
            SkillJudgment(skill="D", present=False),
        ],
    )
    profile = _profile()
    # required: 40 * 2/4 = 20; everything else at full caps (nothing specified)
    assert compute_score(ev, WEIGHTS, profile) == 20 + 20 + 20 + 10 + 10


def test_unknown_must_haves_never_penalize():
    ev = _ev(
        must_have_judgments=[
            MustHaveJudgment(item="onsite", status="unknown"),
            MustHaveJudgment(item="notice", status="unknown"),
        ],
    )
    assert compute_score(ev, WEIGHTS, _profile()) == 100


def test_unmet_must_have_penalizes_proportionally():
    ev = _ev(
        must_have_judgments=[
            MustHaveJudgment(item="onsite", status="unmet"),
            MustHaveJudgment(item="notice", status="met"),
        ],
    )
    # must-haves: 20 * (2-1)/2 = 10
    assert compute_score(ev, WEIGHTS, _profile()) == 90


def test_experience_below_minimum_scales():
    ev = _ev(estimated_total_years=1.0)
    profile = _profile(min_years_experience="4")
    # experience: 20 * 1/4 = 5
    assert compute_score(ev, WEIGHTS, profile) == 100 - 20 + 5


def test_experience_unknown_years_gets_full_points():
    ev = _ev(estimated_total_years=None)
    profile = _profile(min_years_experience="4")
    assert compute_score(ev, WEIGHTS, profile) == 100


def test_no_minimum_specified_ignores_years():
    ev = _ev(estimated_total_years=0.5)
    profile = _profile(min_years_experience="Not specified")
    assert compute_score(ev, WEIGHTS, profile) == 100


def test_education_unmet_zeroes_bucket_only_when_required():
    ev = _ev(education_status="unmet")
    assert compute_score(ev, WEIGHTS, _profile(education="Not specified")) == 100
    assert compute_score(ev, WEIGHTS, _profile(education="B.Tech required")) == 90


def test_hard_filter_fail_scores_zero():
    ev = _ev(
        hard_filter_failed=True,
        required_skill_judgments=[SkillJudgment(skill="A", present=True)],
    )
    assert compute_score(ev, WEIGHTS, _profile()) == 0


def test_score_is_deterministic_and_bounded():
    ev = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="A", present=True),
            SkillJudgment(skill="B", present=False),
            SkillJudgment(skill="C", present=False),
        ],
        must_have_judgments=[MustHaveJudgment(item="x", status="unmet")],
        estimated_total_years=0.5,
        education_status="unmet",
    )
    profile = _profile(min_years_experience="3", education="Degree required")
    first = compute_score(ev, WEIGHTS, profile)
    assert first == compute_score(ev, WEIGHTS, profile)
    assert 0 <= first <= 100
