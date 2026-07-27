"""Deterministic score computation from the evaluator's binary judgments.

The LLM answers only yes/no ("is React Native on this resume?") and
met/unmet/unknown questions; every point award and all arithmetic happens
here. Unknowns never penalize — same philosophy as the hard-filter
UNKNOWN-never-rejects rule.
"""

import re

from ..db.models import CandidateEvaluation, UnifiedRequirements
from ..schemas.requirements import CustomWeights

_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


def _parse_min_years(value: str | None) -> float | None:
    """'1', '2+ years', '1.5' -> float; 'Not specified'/None -> None."""
    if not value:
        return None
    m = _NUMBER_RE.search(value)
    return float(m.group()) if m else None


def _fraction_bucket(cap: int, judgments, is_hit) -> int:
    """cap * hits/total, rounded; empty list = nothing to check = full cap."""
    if not judgments:
        return cap
    hits = sum(1 for j in judgments if is_hit(j))
    return round(cap * hits / len(judgments))


def compute_score(
    ev: CandidateEvaluation,
    weights: CustomWeights,
    profile: UnifiedRequirements,
) -> int:
    if ev.hard_filter_failed:
        return 0

    required = _fraction_bucket(
        weights.required_skills, ev.required_skill_judgments, lambda j: j.present
    )
    preferred = _fraction_bucket(
        weights.preferred_skills, ev.preferred_skill_judgments, lambda j: j.present
    )
    # 'unknown' counts as met: absence of evidence never deducts points
    must_haves = _fraction_bucket(
        weights.must_haves, ev.must_have_judgments, lambda j: j.status != "unmet"
    )

    min_years = _parse_min_years(profile.min_years_experience)
    if min_years is None or min_years <= 0 or ev.estimated_total_years is None:
        experience = weights.experience  # no minimum, or no evidence: full points
    elif ev.estimated_total_years >= min_years:
        experience = weights.experience
    else:
        experience = round(weights.experience * ev.estimated_total_years / min_years)

    education_required = profile.education.strip().lower() not in ("", "not specified")
    if education_required and ev.education_status == "unmet":
        education = 0
    else:
        education = weights.education

    total = required + must_haves + experience + education + preferred
    return max(0, min(100, total))
