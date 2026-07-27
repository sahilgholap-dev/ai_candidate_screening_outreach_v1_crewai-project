"""Renderer for the structured Stage 1 output must be deterministic and
complete: same input -> byte-identical text, every schema field present."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_candidate_screening_outreach.db.models import RequiredSkill, UnifiedRequirements
from ai_candidate_screening_outreach.pipeline.prompt_builder import (
    render_unified_requirements,
)


def _sample() -> UnifiedRequirements:
    return UnifiedRequirements(
        summary="Onsite React Native role blending mobile and AI tooling.",
        required_skills=[
            RequiredSkill(skill="React Native", core=True),
            RequiredSkill(skill="TypeScript", core=False),
            RequiredSkill(skill="Prompt engineering", core=True),
        ],
        preferred_skills=["Expo", "CI/CD"],
        min_years_experience="1",
        location="Thane, India; relocation acceptable",
        work_mode="On-site",
        work_authorization="Not specified",
        education="Not specified",
        must_haves=["Willing to work onsite"],
        nice_to_haves=["Open-source contributions"],
        compensation_budget="Not specified",
    )


def test_render_is_deterministic():
    assert render_unified_requirements(_sample()) == render_unified_requirements(
        _sample()
    )


def test_render_contains_all_sections_and_items():
    text = render_unified_requirements(_sample())
    for heading in [
        "Summary",
        "Required Skills",
        "Preferred / Nice-to-Have Skills",
        "Minimum Years of Experience",
        "Location",
        "Work Mode",
        "Work Authorization",
        "Education Requirements",
        "Must-Haves",
        "Nice-to-Haves",
        "Compensation Budget",
    ]:
        assert heading in text, f"missing section: {heading}"
    assert "React Native (core)" in text
    assert "TypeScript" in text and "TypeScript (core)" not in text
    assert "Willing to work onsite" in text


def test_profile_round_trips_through_json_storage():
    # runner stores model_dump() on the campaign row and re-validates on
    # reuse; the rendered rubric must come back byte-identical
    original = _sample()
    restored = UnifiedRequirements.model_validate(original.model_dump())
    assert render_unified_requirements(restored) == render_unified_requirements(
        original
    )


def test_render_empty_lists_say_not_specified():
    profile = UnifiedRequirements(summary="Role.")
    text = render_unified_requirements(profile)
    # every list field defaults empty -> rendered as Not specified, not omitted
    assert text.count("Not specified") >= 8
