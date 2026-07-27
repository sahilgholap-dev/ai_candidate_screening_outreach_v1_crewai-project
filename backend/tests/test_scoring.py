"""compute_score turns the evaluator's binary judgments into the 0-100 score.
All arithmetic lives here (deterministic), never in the LLM."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_candidate_screening_outreach.db.models import (
    CandidateEvaluation,
    MustHaveJudgment,
    RequiredSkill,
    SkillJudgment,
    UnifiedRequirements,
)
from ai_candidate_screening_outreach.pipeline.scoring import (
    compute_score,
    judgment_record,
)
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


def test_core_skills_weigh_three_times_supporting():
    profile = _profile(
        required_skills=[
            RequiredSkill(skill="React Native", core=True),
            RequiredSkill(skill="GraphQL", core=False),
            RequiredSkill(skill="Git", core=False),
            RequiredSkill(skill="CI/CD", core=False),
        ]
    )
    # missing ONLY the core skill: 40 * 3/(3+3) = 20 — half the bucket gone
    ev = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="React Native", present=False),
            SkillJudgment(skill="GraphQL", present=True),
            SkillJudgment(skill="Git", present=True),
            SkillJudgment(skill="CI/CD", present=True),
        ]
    )
    assert compute_score(ev, WEIGHTS, profile) == 20 + 20 + 20 + 10 + 10

    # missing ONLY one supporting skill: 40 * 5/6 ≈ 33 — a small dent
    ev2 = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="React Native", present=True),
            SkillJudgment(skill="GraphQL", present=False),
            SkillJudgment(skill="Git", present=True),
            SkillJudgment(skill="CI/CD", present=True),
        ]
    )
    assert compute_score(ev2, WEIGHTS, profile) == 33 + 20 + 20 + 10 + 10


def test_core_lookup_tolerates_case_and_core_suffix():
    profile = _profile(
        required_skills=[RequiredSkill(skill="React Native", core=True)]
    )
    # evaluator copied the rendered label verbatim, including the marker
    ev = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="react native (core)", present=False)
        ]
    )
    # single core skill missing: bucket = 0
    assert compute_score(ev, WEIGHTS, profile) == 0 + 20 + 20 + 10 + 10


def test_judgments_without_profile_match_weigh_as_supporting():
    # unknown skill text falls back to weight 1 — behaves like the old flat math
    ev = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="A", present=True),
            SkillJudgment(skill="B", present=False),
        ]
    )
    assert compute_score(ev, WEIGHTS, _profile()) == 20 + 20 + 20 + 10 + 10


def test_judgment_record_carries_ticks_and_bucket_points():
    profile = _profile(
        required_skills=[
            RequiredSkill(skill="React Native", core=True),
            RequiredSkill(skill="Git", core=False),
        ],
        min_years_experience="2",
    )
    ev = _ev(
        required_skill_judgments=[
            SkillJudgment(skill="React Native", present=True),
            SkillJudgment(skill="Git", present=False),
        ],
        preferred_skill_judgments=[SkillJudgment(skill="Expo", present=True)],
        must_have_judgments=[MustHaveJudgment(item="onsite", status="unknown")],
        estimated_total_years=3.0,
    )
    rec = judgment_record(ev, WEIGHTS, profile)

    assert rec["required_skills"] == [
        {"skill": "React Native", "present": True, "core": True},
        {"skill": "Git", "present": False, "core": False},
    ]
    assert rec["preferred_skills"] == [{"skill": "Expo", "present": True}]
    assert rec["must_haves"] == [{"item": "onsite", "status": "unknown"}]
    assert rec["estimated_total_years"] == 3.0

    buckets = rec["breakdown"]["buckets"]
    # required: 40 * 3/(3+1) = 30; everything else full
    assert buckets["required_skills"] == {"points": 30, "cap": 40}
    assert buckets["must_haves"] == {"points": 20, "cap": 20}
    assert buckets["experience"] == {"points": 20, "cap": 20}
    assert buckets["education"] == {"points": 10, "cap": 10}
    assert buckets["preferred_skills"] == {"points": 10, "cap": 10}
    assert rec["breakdown"]["total"] == 90
    assert rec["breakdown"]["total"] == compute_score(ev, WEIGHTS, profile)


def test_judgment_record_hard_filter_zeroes_total():
    ev = _ev(
        hard_filter_failed=True,
        required_skill_judgments=[SkillJudgment(skill="A", present=True)],
    )
    rec = judgment_record(ev, WEIGHTS, _profile())
    assert rec["breakdown"]["total"] == 0


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
