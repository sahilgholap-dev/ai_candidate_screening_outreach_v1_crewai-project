// Mirrors backend RequirementsProfileV1 (schemas/requirements.py).
// The server re-validates authoritatively; this drives the form.

export type Mode = "off" | "preference" | "hard_filter";

export type SkillRequirement = { skill: string; min_years: number | null };

export type CustomWeights = {
  required_skills: number;
  must_haves: number;
  experience: number;
  education: number;
  preferred_skills: number;
};

export type RequirementsProfile = {
  version: 1;
  // 1. Role & context
  seniority: "junior" | "mid" | "senior" | "lead" | "manager" | null;
  openings: number | null;
  target_join_date: string | null;
  role_type: "ic" | "manager" | "either";
  industries: string[];
  industries_mode: Mode;
  // 2. Location & work mode
  work_mode: "onsite" | "hybrid" | "remote" | null;
  hybrid_days_per_week: number | null;
  office_location: string | null;
  commute_rule: "same_city" | "metro_area" | "radius_km" | null;
  commute_radius_km: number | null;
  relocation_acceptable: boolean;
  relocation_assistance: boolean;
  remote_scope: "in_country" | "international" | null;
  timezone_overlap_zone: string | null;
  timezone_overlap_hours: number | null;
  location_mode: Mode;
  // 3. Work authorization
  us_work_auth_required: boolean | null;
  us_sponsorship: "none" | "transfer_only" | "new_ok" | null;
  us_opt_cpt_ok: boolean | null;
  us_employment_type: "w2" | "c2c" | "1099" | "any" | null;
  uk_right_to_work_required: boolean | null;
  uk_sponsor_available: boolean | null;
  work_auth_mode: Mode;
  // 4. Experience
  min_years_experience: number | null;
  target_years_min: number | null;
  target_years_max: number | null;
  hands_on_requirements: string[];
  hands_on_mode: Mode;
  company_stage_pref: "startup" | "mnc" | "agency" | "enterprise" | null;
  flag_employment_gaps: boolean;
  experience_mode: Mode;
  // 5. Skills & qualifications
  must_have_skills: SkillRequirement[];
  must_have_skills_mode: Mode;
  nice_to_have_skills: string[];
  certifications: string[];
  certifications_mode: Mode;
  licenses: string[];
  licenses_mode: Mode;
  portfolio_required: boolean;
  education_degree_required: boolean;
  education_field: string | null;
  education_equivalent_ok: boolean;
  education_mode: Mode;
  // 6. Compensation
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: "USD" | "GBP" | "INR" | null;
  flag_over_budget: boolean;
  // 7. Availability
  max_notice_days: number | null;
  immediate_joiners_only: boolean;
  shift: "day" | "night" | "rotational" | "on_call" | null;
  contract_type: "permanent" | "fixed_term" | "contract" | "contract_to_hire" | null;
  travel_percent_max: number | null;
  availability_mode: Mode;
  // 8. Language
  english_spoken: "basic" | "professional" | "fluent" | null;
  english_written: "basic" | "professional" | "fluent" | null;
  other_languages: string[];
  language_mode: Mode;
  // 9. Pipeline behavior
  maybe_band: number;
  weight_preset: "balanced" | "skills_first" | "experience_first" | "custom";
  custom_weights: CustomWeights | null;
  dealbreakers: string | null;
  max_shortlist: number | null;
  // 10. Role context & culture (client form v2)
  role_title: string | null;
  urgency: "standard" | "high" | "critical" | null;
  team_context: string | null;
  culture_text: string | null;
  positive_signals: string[];
  concern_signals: string[];
};

// Mirrors WEIGHT_PRESETS in backend schemas/requirements.py — keep in sync.
export const WEIGHT_PRESETS: Record<
  Exclude<RequirementsProfile["weight_preset"], "custom">,
  CustomWeights
> = {
  balanced: {
    required_skills: 40,
    must_haves: 25,
    experience: 15,
    education: 10,
    preferred_skills: 10,
  },
  skills_first: {
    required_skills: 50,
    must_haves: 20,
    experience: 10,
    education: 5,
    preferred_skills: 15,
  },
  experience_first: {
    required_skills: 30,
    must_haves: 20,
    experience: 30,
    education: 10,
    preferred_skills: 10,
  },
};

// Recruiter-facing names for the five scoring areas, in display order.
export const WEIGHT_LABELS: Record<keyof CustomWeights, string> = {
  required_skills: "Required skills",
  must_haves: "Must-haves",
  experience: "Experience",
  education: "Education",
  preferred_skills: "Nice-to-have skills",
};

export function weightsTotal(w: CustomWeights): number {
  return (
    w.required_skills +
    w.must_haves +
    w.experience +
    w.education +
    w.preferred_skills
  );
}

export function defaultRequirements(): RequirementsProfile {
  return {
    version: 1,
    seniority: null,
    openings: null,
    target_join_date: null,
    role_type: "either",
    industries: [],
    industries_mode: "off",
    work_mode: null,
    hybrid_days_per_week: null,
    office_location: null,
    commute_rule: null,
    commute_radius_km: null,
    relocation_acceptable: true,
    relocation_assistance: false,
    remote_scope: null,
    timezone_overlap_zone: null,
    timezone_overlap_hours: null,
    location_mode: "hard_filter",
    us_work_auth_required: null,
    us_sponsorship: null,
    us_opt_cpt_ok: null,
    us_employment_type: null,
    uk_right_to_work_required: null,
    uk_sponsor_available: null,
    work_auth_mode: "off",
    min_years_experience: null,
    target_years_min: null,
    target_years_max: null,
    hands_on_requirements: [],
    hands_on_mode: "off",
    company_stage_pref: null,
    flag_employment_gaps: false,
    experience_mode: "off",
    must_have_skills: [],
    must_have_skills_mode: "preference",
    nice_to_have_skills: [],
    certifications: [],
    certifications_mode: "off",
    licenses: [],
    licenses_mode: "off",
    portfolio_required: false,
    education_degree_required: false,
    education_field: null,
    education_equivalent_ok: true,
    education_mode: "off",
    budget_min: null,
    budget_max: null,
    budget_currency: null,
    flag_over_budget: true,
    max_notice_days: null,
    immediate_joiners_only: false,
    shift: null,
    contract_type: null,
    travel_percent_max: null,
    availability_mode: "off",
    english_spoken: null,
    english_written: null,
    other_languages: [],
    language_mode: "off",
    maybe_band: 10,
    weight_preset: "balanced",
    custom_weights: null,
    dealbreakers: null,
    max_shortlist: null,
    role_title: null,
    urgency: null,
    team_context: null,
    culture_text: null,
    positive_signals: [],
    concern_signals: [],
  };
}

export type MyCompany = {
  id: number;
  name: string;
  default_region: "US" | "UK" | "IN";
  default_threshold: number;
  office_locations: string[];
  recruiter_signature: string | null;
  tone_notes: string | null;
  data_retention_days: number | null;
};
