"""Versioned Requirements Profile — the recruiter's structured answers at
campaign creation. Merged with (and overriding) the JD extraction in the
pipeline (Phase 4).

Every filterable criterion carries a `mode`:
  - "off"          not evaluated
  - "preference"   affects scoring, never rejects
  - "hard_filter"  can reject, with PASS/FAIL/UNKNOWN semantics —
                   FAIL only on explicit contradicting resume evidence;
                   UNKNOWN routes to human review, never auto-reject.
"""

from datetime import date
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Mode(str, Enum):
    off = "off"
    preference = "preference"
    hard_filter = "hard_filter"


class SkillRequirement(BaseModel):
    skill: str = Field(min_length=1, max_length=100)
    min_years: Optional[float] = Field(default=None, ge=0, le=50)


class CustomWeights(BaseModel):
    """Scoring bucket caps; must sum to 100."""

    required_skills: int = Field(default=40, ge=0, le=100)
    must_haves: int = Field(default=25, ge=0, le=100)
    experience: int = Field(default=15, ge=0, le=100)
    education: int = Field(default=10, ge=0, le=100)
    preferred_skills: int = Field(default=10, ge=0, le=100)

    @model_validator(mode="after")
    def _sums_to_100(self):
        total = (
            self.required_skills
            + self.must_haves
            + self.experience
            + self.education
            + self.preferred_skills
        )
        if total != 100:
            raise ValueError(f"Weights must sum to 100 (got {total})")
        return self


WEIGHT_PRESETS: dict[str, CustomWeights] = {
    "balanced": CustomWeights(),
    "skills_first": CustomWeights(
        required_skills=50, must_haves=20, experience=10, education=5, preferred_skills=15
    ),
    "experience_first": CustomWeights(
        required_skills=30, must_haves=20, experience=30, education=10, preferred_skills=10
    ),
}


class RequirementsProfileV1(BaseModel):
    version: Literal[1] = 1

    # ---- 1. Role & context ----
    seniority: Optional[Literal["junior", "mid", "senior", "lead", "manager"]] = None
    openings: Optional[int] = Field(default=None, ge=1, le=500)
    target_join_date: Optional[date] = None
    role_type: Literal["ic", "manager", "either"] = "either"
    industries: list[str] = []
    industries_mode: Mode = Mode.off

    # ---- 2. Location & work mode ----
    work_mode: Optional[Literal["onsite", "hybrid", "remote"]] = None
    hybrid_days_per_week: Optional[int] = Field(default=None, ge=1, le=6)
    office_location: Optional[str] = Field(default=None, max_length=200)
    commute_rule: Optional[Literal["same_city", "metro_area", "radius_km"]] = None
    commute_radius_km: Optional[int] = Field(default=None, ge=1, le=500)
    relocation_acceptable: bool = True
    relocation_assistance: bool = False
    remote_scope: Optional[Literal["in_country", "international"]] = None
    timezone_overlap_zone: Optional[str] = Field(default=None, max_length=50)
    timezone_overlap_hours: Optional[int] = Field(default=None, ge=1, le=12)
    location_mode: Mode = Mode.hard_filter

    # ---- 3. Work authorization (region-conditional) ----
    us_work_auth_required: Optional[bool] = None
    us_sponsorship: Optional[Literal["none", "transfer_only", "new_ok"]] = None
    us_opt_cpt_ok: Optional[bool] = None
    us_employment_type: Optional[Literal["w2", "c2c", "1099", "any"]] = None
    uk_right_to_work_required: Optional[bool] = None
    uk_sponsor_available: Optional[bool] = None
    work_auth_mode: Mode = Mode.off

    # ---- 4. Experience ----
    min_years_experience: Optional[float] = Field(default=None, ge=0, le=50)
    target_years_min: Optional[float] = Field(default=None, ge=0, le=50)
    target_years_max: Optional[float] = Field(default=None, ge=0, le=60)
    hands_on_requirements: list[str] = []
    hands_on_mode: Mode = Mode.off
    company_stage_pref: Optional[Literal["startup", "mnc", "agency", "enterprise"]] = None
    flag_employment_gaps: bool = False
    experience_mode: Mode = Mode.off

    # ---- 5. Skills & qualifications ----
    must_have_skills: list[SkillRequirement] = []
    must_have_skills_mode: Mode = Mode.preference
    nice_to_have_skills: list[str] = []
    certifications: list[str] = []
    certifications_mode: Mode = Mode.off
    licenses: list[str] = []
    licenses_mode: Mode = Mode.off
    portfolio_required: bool = False  # scoring only
    education_degree_required: bool = False
    education_field: Optional[str] = Field(default=None, max_length=200)
    education_equivalent_ok: bool = True
    education_mode: Mode = Mode.off

    # ---- 6. Compensation (flag-only by design — never auto-rejects) ----
    budget_min: Optional[float] = Field(default=None, ge=0)
    budget_max: Optional[float] = Field(default=None, ge=0)
    budget_currency: Optional[Literal["USD", "GBP", "INR"]] = None
    flag_over_budget: bool = True

    # ---- 7. Availability & logistics ----
    max_notice_days: Optional[int] = Field(default=None, ge=0, le=365)
    immediate_joiners_only: bool = False
    shift: Optional[Literal["day", "night", "rotational", "on_call"]] = None
    contract_type: Optional[
        Literal["permanent", "fixed_term", "contract", "contract_to_hire"]
    ] = None
    travel_percent_max: Optional[int] = Field(default=None, ge=0, le=100)
    availability_mode: Mode = Mode.off

    # ---- 8. Language & communication ----
    english_spoken: Optional[Literal["basic", "professional", "fluent"]] = None
    english_written: Optional[Literal["basic", "professional", "fluent"]] = None
    other_languages: list[str] = []
    language_mode: Mode = Mode.off

    # ---- 9. Pipeline behavior ----
    maybe_band: int = Field(default=10, ge=0, le=30)
    weight_preset: Literal["balanced", "skills_first", "experience_first", "custom"] = (
        "balanced"
    )
    custom_weights: Optional[CustomWeights] = None
    dealbreakers: Optional[str] = Field(default=None, max_length=2000)
    max_shortlist: Optional[int] = Field(default=None, ge=1, le=500)

    @model_validator(mode="after")
    def _validate(self):
        if self.weight_preset == "custom" and self.custom_weights is None:
            raise ValueError("custom_weights is required when weight_preset is 'custom'")
        if (
            self.budget_min is not None
            and self.budget_max is not None
            and self.budget_min > self.budget_max
        ):
            raise ValueError("budget_min cannot exceed budget_max")
        if (
            self.target_years_min is not None
            and self.target_years_max is not None
            and self.target_years_min > self.target_years_max
        ):
            raise ValueError("target_years_min cannot exceed target_years_max")
        return self

    def effective_weights(self) -> CustomWeights:
        if self.weight_preset == "custom" and self.custom_weights:
            return self.custom_weights
        return WEIGHT_PRESETS.get(self.weight_preset, WEIGHT_PRESETS["balanced"])
