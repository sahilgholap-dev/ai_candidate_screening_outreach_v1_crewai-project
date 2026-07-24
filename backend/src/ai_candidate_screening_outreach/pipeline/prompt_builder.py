"""Builds the dynamic prompt blocks injected into the screening tasks from a
campaign's RequirementsProfile and its company profile.

Everything returned here is plain text inserted as CrewAI kickoff inputs —
never re-interpolated, so content is free-form.
"""

from ..db.models import Campaign, Company
from ..schemas.requirements import CustomWeights, RequirementsProfileV1

REGION_NAMES = {"US": "United States", "UK": "United Kingdom", "IN": "India"}


def load_profile(campaign: Campaign) -> RequirementsProfileV1 | None:
    if not campaign.requirements:
        return None
    try:
        return RequirementsProfileV1.model_validate(campaign.requirements)
    except ValueError:
        return None


# ---------------------------------------------------------------- recruiter block

def build_recruiter_requirements_block(
    profile: RequirementsProfileV1 | None, region: str
) -> str:
    """Human-readable summary of the form answers, merged into Stage 1.
    Only includes what the recruiter actually set."""
    if profile is None:
        return "(none provided — rely on the job description alone)"

    lines: list[str] = []

    def add(label: str, value) -> None:
        if value not in (None, "", [], "either"):
            lines.append(f"- {label}: {value}")

    add("Region", REGION_NAMES.get(region, region))
    add("Seniority", profile.seniority)
    add("Openings", profile.openings)
    add("Target join date", profile.target_join_date)
    if profile.role_type != "either":
        add("Role type", "People manager" if profile.role_type == "manager" else "Individual contributor")
    if profile.industries:
        add("Industry background", ", ".join(profile.industries))

    if profile.work_mode:
        wm = profile.work_mode
        if wm == "hybrid" and profile.hybrid_days_per_week:
            wm += f" ({profile.hybrid_days_per_week} days/week in office)"
        add("Work mode", wm)
    add("Office location", profile.office_location)
    if profile.commute_rule:
        rule = {
            "same_city": "same city only",
            "metro_area": "same metropolitan area or adjacent commutable cities",
            "radius_km": f"within {profile.commute_radius_km or '?'} km",
        }[profile.commute_rule]
        add("Commute rule", rule)
    add("Relocation acceptable", "yes" if profile.relocation_acceptable else "no")
    if profile.relocation_assistance:
        add("Relocation assistance offered", "yes")
    if profile.remote_scope:
        add("Remote scope", profile.remote_scope.replace("_", " "))
    if profile.timezone_overlap_zone:
        add(
            "Timezone overlap",
            f"≥{profile.timezone_overlap_hours or 4}h with {profile.timezone_overlap_zone}",
        )

    if region == "US":
        if profile.us_work_auth_required:
            add("US work authorization", "required")
        if profile.us_sponsorship:
            add(
                "Visa sponsorship",
                {
                    "none": "not available",
                    "transfer_only": "H-1B transfer only",
                    "new_ok": "new sponsorship possible",
                }[profile.us_sponsorship],
            )
        if profile.us_opt_cpt_ok is not None:
            add("OPT/CPT candidates", "acceptable" if profile.us_opt_cpt_ok else "not acceptable")
        if profile.us_employment_type and profile.us_employment_type != "any":
            add("Employment type", profile.us_employment_type.upper())
    if region == "UK":
        if profile.uk_right_to_work_required:
            add("UK right to work", "required")
        if profile.uk_sponsor_available is not None:
            add(
                "Skilled Worker sponsorship",
                "available" if profile.uk_sponsor_available else "not available",
            )

    add("Minimum years of experience", profile.min_years_experience)
    if profile.target_years_min is not None or profile.target_years_max is not None:
        add(
            "Target experience range (soft)",
            f"{profile.target_years_min or 0}–{profile.target_years_max or '∞'} years",
        )
    if profile.hands_on_requirements:
        add("Hands-on requirements", "; ".join(profile.hands_on_requirements))
    add("Company-stage preference (soft)", profile.company_stage_pref)

    if profile.must_have_skills:
        add(
            "Must-have skills",
            ", ".join(
                f"{s.skill} ({s.min_years}+ yrs)" if s.min_years else s.skill
                for s in profile.must_have_skills
            ),
        )
    if profile.nice_to_have_skills:
        add("Nice-to-have skills", ", ".join(profile.nice_to_have_skills))
    if profile.certifications:
        add("Certifications", ", ".join(profile.certifications))
    if profile.licenses:
        add("Licenses", ", ".join(profile.licenses))
    if profile.portfolio_required:
        add("Portfolio/GitHub", "required (scoring only, never a hard filter)")
    if profile.education_degree_required:
        edu = "degree required"
        if profile.education_field:
            edu += f" in {profile.education_field}"
        if profile.education_equivalent_ok:
            edu += " (equivalent experience acceptable)"
        add("Education", edu)

    if profile.budget_min or profile.budget_max:
        cur = profile.budget_currency or ""
        add("Compensation budget", f"{cur} {profile.budget_min or '?'}–{profile.budget_max or '?'} (flag-only, never reject)")

    add("Max notice period (days)", profile.max_notice_days)
    if profile.immediate_joiners_only:
        add("Immediate joiners", "only")
    add("Shift", profile.shift)
    add("Contract type", profile.contract_type)
    add("Max travel %", profile.travel_percent_max)

    add("English (spoken)", profile.english_spoken)
    add("English (written)", profile.english_written)
    if profile.other_languages:
        add("Additional languages", ", ".join(profile.other_languages))

    if profile.dealbreakers:
        add("Dealbreakers", profile.dealbreakers)

    if not lines:
        return "(none provided — rely on the job description alone)"
    return "\n".join(lines)


# ---------------------------------------------------------------- hard filters

def build_hard_filter_rules(profile: RequirementsProfileV1 | None) -> str:
    """Numbered hard-filter list with PASS/FAIL/UNKNOWN semantics. Only
    criteria the recruiter set to hard_filter appear."""
    rules: list[str] = []

    def hf(title: str, body: str) -> None:
        rules.append(f"**{len(rules) + 1}. {title}:**\n{body}")

    if profile is None or profile.location_mode.value == "hard_filter":
        commute = "the same metropolitan area or geographically adjacent/commutable cities (e.g. Mumbai/Navi Mumbai to Thane)"
        if profile:
            if profile.commute_rule == "same_city":
                commute = "the same city only"
            elif profile.commute_rule == "radius_km" and profile.commute_radius_km:
                commute = f"within roughly {profile.commute_radius_km} km"
        reloc = (
            "PASS if the resume explicitly states willingness to relocate or commute. "
            if (profile is None or profile.relocation_acceptable)
            else "Relocation is NOT acceptable for this role. "
        )
        hf(
            "Location",
            f"- PASS if located in the required location, or in {commute}.\n"
            f"- {reloc}\n"
            "- FAIL only if located in a clearly incompatible/distant location AND no relocation/commute signal exists.\n"
            "- If the requirements specify no location or the role is remote → everyone passes.\n"
            "- UNKNOWN if the resume states no location at all.",
        )

    if profile is None or (
        profile.experience_mode.value == "hard_filter"
        and profile.min_years_experience is not None
    ):
        years = profile.min_years_experience if profile else None
        if years is not None:
            hf(
                "Minimum experience",
                f"- The explicit minimum is {years} years.\n"
                "- PASS if total career experience meets or exceeds it (calculate from work history dates when not stated).\n"
                "- FAIL if clearly below the minimum.\n"
                "- UNKNOWN if the resume gives no dates or duration evidence.",
            )
        else:
            hf(
                "Minimum experience",
                "- ONLY applies if the Unified Requirements state an explicit numeric minimum.\n"
                "- If no minimum is stated → this filter DOES NOT EXIST; zero candidates may be filtered for experience.",
            )

    if profile:
        if profile.work_auth_mode.value == "hard_filter":
            hf(
                "Work authorization",
                "- Apply the work-authorization requirements from the Unified Requirements Profile.\n"
                "- FAIL only on explicit contradicting evidence (e.g. resume states a visa status the role cannot support).\n"
                "- UNKNOWN if the resume does not mention authorization status (very common — most resumes don't).",
            )
        if profile.must_have_skills_mode.value == "hard_filter" and profile.must_have_skills:
            skills = ", ".join(
                f"{s.skill}{f' ({s.min_years}+ yrs)' if s.min_years else ''}"
                for s in profile.must_have_skills
            )
            hf(
                "Must-have skills",
                f"- Required: {skills}.\n"
                "- PASS if every listed skill appears on the resume (a skill listed on the resume ALWAYS counts as present).\n"
                "- FAIL if one or more required skills are absent from the resume entirely.\n"
                "- Where a minimum-years depth is stated and the resume shows the skill but depth cannot be established, treat that skill as present and add it to needs_info.",
            )
        if profile.industries_mode.value == "hard_filter" and profile.industries:
            hf(
                "Industry background",
                f"- Required industry experience: {', '.join(profile.industries)}.\n"
                "- PASS if work history shows experience in any listed industry.\n"
                "- FAIL if the full work history is clearly in unrelated industries.\n"
                "- UNKNOWN if employers' industries cannot be determined.",
            )
        if profile.hands_on_mode.value == "hard_filter" and profile.hands_on_requirements:
            hf(
                "Hands-on requirements",
                f"- Required: {'; '.join(profile.hands_on_requirements)}.\n"
                "- PASS if the resume evidences each requirement.\n"
                "- FAIL only if the resume clearly contradicts one.\n"
                "- UNKNOWN if the resume simply doesn't address it.",
            )
        if profile.certifications_mode.value == "hard_filter" and profile.certifications:
            hf(
                "Certifications",
                f"- Required: {', '.join(profile.certifications)}.\n"
                "- PASS if held (or a clearly equivalent certification). FAIL if absent — certifications are binary; absence from the resume is FAIL, not UNKNOWN.",
            )
        if profile.licenses_mode.value == "hard_filter" and profile.licenses:
            hf(
                "Licenses",
                f"- Required: {', '.join(profile.licenses)}.\n"
                "- PASS if held. FAIL if absent from the resume.",
            )
        if profile.education_mode.value == "hard_filter" and profile.education_degree_required:
            edu = "a degree"
            if profile.education_field:
                edu += f" in {profile.education_field} (or a closely related field)"
            equiv = (
                " Equivalent professional experience is acceptable in place of the degree."
                if profile.education_equivalent_ok
                else ""
            )
            hf(
                "Education",
                f"- Required: {edu}.{equiv}\n"
                "- FAIL only if education is listed and clearly does not meet the bar"
                + (" and experience does not compensate." if profile.education_equivalent_ok else ".")
                + "\n- UNKNOWN if education is not mentioned.",
            )
        if profile.availability_mode.value == "hard_filter":
            parts = []
            if profile.max_notice_days is not None:
                parts.append(f"notice period ≤ {profile.max_notice_days} days")
            if profile.immediate_joiners_only:
                parts.append("immediate joiners only")
            if profile.shift:
                parts.append(f"{profile.shift} shift")
            if profile.contract_type:
                parts.append(f"{profile.contract_type.replace('_', ' ')} contract")
            if parts:
                hf(
                    "Availability & logistics",
                    f"- Required: {', '.join(parts)}.\n"
                    "- FAIL only on explicit contradicting evidence on the resume.\n"
                    "- UNKNOWN if the resume doesn't state it (resumes rarely state notice periods — expect UNKNOWN often).",
                )
        if profile.language_mode.value == "hard_filter":
            parts = []
            if profile.english_spoken:
                parts.append(f"English spoken: {profile.english_spoken}")
            if profile.english_written:
                parts.append(f"English written: {profile.english_written}")
            if profile.other_languages:
                parts.append(f"languages: {', '.join(profile.other_languages)}")
            if parts:
                hf(
                    "Language",
                    f"- Required: {'; '.join(parts)}.\n"
                    "- FAIL only on explicit contradicting evidence. UNKNOWN when the resume is silent.",
                )
        if profile.gender_eligibility != "any":
            who = "women" if profile.gender_eligibility == "women_only" else "men"
            hf(
                "Gender eligibility (lawful restriction — justification on file)",
                f"- This role is restricted to {who} ({profile.gender_justification}).\n"
                "- Gender may be established ONLY from an explicit statement on the resume "
                "(e.g. a 'Gender:' field, salutation such as Ms./Mrs./Mr., or explicit pronouns in a self-summary).\n"
                "- NEVER infer gender from the candidate's name, photo, or anything else.\n"
                "- FAIL only when the resume explicitly states a non-matching gender.\n"
                "- UNKNOWN when gender is not explicitly stated — add 'gender_eligibility' to needs_info; NEVER reject.",
            )

    header = (
        "Permitted hard filter reasons — ONLY the following, no others may ever be invented:\n\n"
    )
    footer = (
        "\n\n**Hard-filter verdicts:** each filter above resolves to PASS, FAIL, or UNKNOWN per candidate.\n"
        "- FAIL requires explicit contradicting evidence on the resume. Score = 0, "
        'Recommendation = "Reject (Hard Filter)", Hard Filter Failed = Y. Write one line in Scoring Notes naming the filter and the evidence. No scoring table for them.\n'
        "- UNKNOWN (no evidence either way) NEVER rejects: evaluate the candidate normally and add the filter name to their needs_info list.\n"
        "- All non-FAIL candidates proceed to Step 2."
    )
    return header + "\n\n".join(rules) + footer


# ---------------------------------------------------------------- scoring

def build_scoring_rules(weights: CustomWeights, education_neutral_note: bool = True) -> str:
    w = weights
    total_check = f"{w.required_skills} + {w.must_haves} + {w.experience} + {w.education} + {w.preferred_skills}"
    return f"""**STEP 2 — Score each non-FAIL candidate using this exact table:**

| Bucket | Cap | Score Awarded | Justification |
|---|---|---|---|
| Required Skills match | {w.required_skills} | ? | List each matched/unmatched required skill |
| Must-Haves met | {w.must_haves} | ? | List each listed must-have and whether met |
| Years of experience quality | {w.experience} | ? | See rule below |
| Education match | {w.education} | ? | See rule below |
| Preferred / Nice-to-Have skills | {w.preferred_skills} | ? | List matched preferred skills |
| **TOTAL** | **100** | **?** | **Write: B1 + B2 + B3 + B4 + B5 = Total** |

**Bucket rules — every rule is absolute:**

*Required Skills (cap {w.required_skills}):*
- If a skill or tool appears on the candidate's resume, it MUST be counted as present. Never mark a skill as missing if it is listed on their resume.
- Score awarded ≤ {w.required_skills}. If you write a number above {w.required_skills}, replace it with {w.required_skills} before continuing.

*Must-Haves (cap {w.must_haves}) — READ TWICE BEFORE SCORING:*
- This bucket covers ONLY criteria explicitly labeled as must-haves in the Unified Requirements Profile — typically location/relocation, work authorization, and availability items.
- BANNED from this bucket (these NEVER reduce Must-Have points): portfolio quality, shipping history, degree/education level, years of experience, any criterion marked "Not specified", any criterion you inferred.
- A candidate who meets all listed must-haves scores {w.must_haves}/{w.must_haves}.
- Score awarded ≤ {w.must_haves}.

*Years of Experience (cap {w.experience}) — READ TWICE BEFORE SCORING:*
- If no numeric minimum or target range is specified → type exactly "{w.experience}" for EVERY candidate. Do not scale. Do not assess years.
- If a minimum IS specified → award {w.experience} for meeting/exceeding it, scale proportionally for falling short.
- If a soft target range is specified → candidates within range get {w.experience}; far above range: award full points but add 'overqualified' to their flags list (never deduct for being above range).
- Score awarded ≤ {w.experience}.

*Education (cap {w.education}) — READ TWICE BEFORE SCORING:*
- If education is "Not specified" in the Unified Requirements → type exactly "{w.education}" for EVERY candidate. Never penalize self-taught candidates.{" " if education_neutral_note else ""}
- If a degree/field IS required → score accordingly (equivalent experience counts when allowed).
- Score awarded ≤ {w.education}.

*Preferred / Nice-to-Have skills (cap {w.preferred_skills}):*
- Score awarded ≤ {w.preferred_skills}.

**Arithmetic check:** B1 + B2 + B3 + B4 + B5 = Total, where the caps are {total_check} = 100."""


# ---------------------------------------------------------------- extra rules

def build_extra_rules(profile: RequirementsProfileV1 | None) -> str:
    """Flag rules (never rejecting) + dealbreakers + shortlist cap."""
    rules: list[str] = []
    if profile:
        if profile.flag_over_budget and (profile.budget_min or profile.budget_max):
            cur = profile.budget_currency or ""
            rules.append(
                f"- Compensation budget is {cur} {profile.budget_min or '?'}–{profile.budget_max or '?'}. "
                "If the resume explicitly states expectations above budget, add 'over_budget' to flags. "
                "NEVER reject or deduct points for compensation. Never extract or consider salary history."
            )
        if profile.flag_employment_gaps:
            rules.append(
                "- If the work history shows a gap longer than 6 months, add 'employment_gap' to flags. Never deduct points or reject for gaps."
            )
        if profile.portfolio_required:
            rules.append(
                "- A portfolio/GitHub link is expected: candidates without one lose points ONLY in the Preferred bucket and get 'no_portfolio' added to flags."
            )
        if profile.dealbreakers:
            rules.append(
                f"- Recruiter dealbreakers (treat as a hard filter with the same FAIL-needs-evidence / UNKNOWN-never-rejects semantics): {profile.dealbreakers}"
            )
        if profile.max_shortlist:
            rules.append(
                f"- Shortlist AT MOST {profile.max_shortlist} candidates. If more clear the threshold, keep the top {profile.max_shortlist} by score and mark the rest 'Maybe'."
            )
    if not rules:
        return "(no additional flag rules)"
    return "\n".join(rules)


# ---------------------------------------------------------------- outreach

def build_outreach_context(company: Company | None, campaign: Campaign) -> dict[str, str]:
    signature = (company.recruiter_signature if company else None) or "The Recruitment Team"
    return {
        "company_name": (company.name if company else None) or "our company",
        "company_pitch": (company.pitch if company else None)
        or "(no company pitch on file — describe the opportunity from the job description)",
        "recruiter_signature": signature,
        "tone_notes": (company.tone_notes if company else None)
        or "Professional yet warm.",
    }
