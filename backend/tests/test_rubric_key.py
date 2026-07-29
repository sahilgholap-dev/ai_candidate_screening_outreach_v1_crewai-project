"""Rubric key: identical (JD, requirements) inputs -> identical key."""

from ai_candidate_screening_outreach.pipeline.runner import rubric_key
from ai_candidate_screening_outreach.schemas.requirements import (
    RequirementsProfileV1,
)


def test_same_inputs_same_key():
    p1 = RequirementsProfileV1.model_validate({"version": 1, "maybe_band": 10})
    p2 = RequirementsProfileV1.model_validate({"version": 1, "maybe_band": 10})
    assert rubric_key("JD text", p1) == rubric_key("JD text", p2)


def test_legacy_extra_keys_do_not_change_key():
    plain = RequirementsProfileV1.model_validate({"version": 1})
    legacy = RequirementsProfileV1.model_validate(
        {"version": 1, "gender_eligibility": "any", "gender_justification": None}
    )
    assert rubric_key("JD", plain) == rubric_key("JD", legacy)


def test_jd_whitespace_is_normalized():
    p = RequirementsProfileV1.model_validate({"version": 1})
    assert rubric_key("  JD text \n", p) == rubric_key("JD text", p)


def test_different_jd_different_key():
    p = RequirementsProfileV1.model_validate({"version": 1})
    assert rubric_key("JD A", p) != rubric_key("JD B", p)


def test_different_requirements_different_key():
    p1 = RequirementsProfileV1.model_validate({"version": 1, "maybe_band": 10})
    p2 = RequirementsProfileV1.model_validate({"version": 1, "maybe_band": 15})
    assert rubric_key("JD", p1) != rubric_key("JD", p2)


def test_missing_profile_still_keys_on_jd():
    assert rubric_key("JD", None) == rubric_key("JD", None)
    p = RequirementsProfileV1.model_validate({"version": 1})
    assert rubric_key("JD", None) != rubric_key("JD", p)
