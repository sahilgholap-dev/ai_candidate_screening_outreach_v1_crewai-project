"""Fit bands — the client-facing language for screening outcomes.

Numeric scores and thresholds stay agent-internal (drawer only); every list,
count, and export speaks in bands.
"""

NOT_FIT_RECOMMENDATIONS = {"Reject", "Reject (Hard Filter)", "Duplicate", "Needs Review"}

RECOMMENDED_BANDS = {"ideal", "good"}


def band_for(
    recommendation: str | None,
    score: int | None,
    hard_filter_failed: bool,
    threshold: float,
) -> str:
    """Shortlist -> ideal, Maybe -> good, everything rejected -> not_fit."""
    if hard_filter_failed or (recommendation in NOT_FIT_RECOMMENDATIONS):
        return "not_fit"
    if recommendation == "Shortlist":
        return "ideal"
    if recommendation == "Maybe":
        return "good"
    if recommendation:  # unknown legacy label — treat as not_fit, never hide
        return "not_fit"
    return "unscored"
