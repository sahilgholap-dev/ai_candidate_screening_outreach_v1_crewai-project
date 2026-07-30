"""New client-form fields flow into the prompts."""

from ai_candidate_screening_outreach.pipeline.prompt_builder import (
    build_extra_rules,
    build_recruiter_requirements_block,
)
from ai_candidate_screening_outreach.schemas.requirements import RequirementsProfileV1


def _profile(**kw):
    return RequirementsProfileV1.model_validate({"version": 1, **kw})


def test_fields_validate_and_default():
    p = _profile(
        role_title="Data Engineer",
        urgency="high",
        culture_text="Detail-oriented.",
        positive_signals=["Owned a system"],
        concern_signals=["Job hops"],
        team_context="6 engineers",
    )
    assert p.urgency == "high" and p.positive_signals == ["Owned a system"]
    assert _profile().positive_signals == []


def test_culture_signals_reach_extra_rules():
    rules = build_extra_rules(
        _profile(
            culture_text="Owns things end-to-end.",
            positive_signals=["Owned a system end-to-end"],
            concern_signals=["Frequent job hops"],
        )
    )
    assert "Owned a system end-to-end" in rules
    assert "Frequent job hops" in rules
    assert "culture_match" in rules and "culture_concern" in rules


def test_role_title_reaches_stage1_block():
    block = build_recruiter_requirements_block(
        _profile(role_title="Head of Compliance"), "UK"
    )
    assert "Head of Compliance" in block
