"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Mode, MyCompany, RequirementsProfile } from "@/lib/requirements";

type Region = "US" | "UK" | "IN";

// ---------- small building blocks ----------

const MODE_LABEL: Record<Mode, string> = {
  off: "Off",
  preference: "Preference (scoring)",
  hard_filter: "Hard filter (can reject)",
};

function ModeSelect({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <Select
      items={MODE_LABEL}
      value={value}
      onValueChange={(v) => onChange(v as Mode)}
    >
      <SelectTrigger className="h-8 w-56 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <SelectItem key={m} value={m}>
            {MODE_LABEL[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Section({
  title,
  hint,
  mode,
  onMode,
  children,
}: {
  title: string;
  hint?: string;
  mode?: Mode;
  onMode?: (m: Mode) => void;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border bg-background" open={false}>
      <summary className="flex cursor-pointer list-none items-center justify-between p-4">
        <div>
          <span className="font-medium">{title}</span>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex items-center gap-3">
          {mode !== undefined && onMode && (
            <span onClick={(e) => e.preventDefault()}>
              <ModeSelect value={mode} onChange={onMode} />
            </span>
          )}
          <span className="text-muted-foreground transition-transform group-open:rotate-90">
            ›
          </span>
        </div>
      </summary>
      <div className="space-y-4 border-t p-4">{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
    />
  );
}

function ListInput({
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Textarea
      rows={rows}
      placeholder={placeholder}
      value={value.join("\n")}
      onChange={(e) =>
        onChange(
          e.target.value.split("\n").map((s) => s.trimStart()).filter((s, i, a) =>
            // keep intermediate empty lines while typing, drop only trailing artifacts on parse
            s !== "" || i < a.length - 1,
          ),
        )
      }
    />
  );
}

function EnumSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Not set",
}: {
  value: T | null;
  onChange: (v: T | null) => void;
  options: [T, string][];
  placeholder?: string;
}) {
  const NONE = "__none__";
  const items: Record<string, string> = {
    [NONE]: placeholder,
    ...Object.fromEntries(options),
  };
  return (
    <Select
      items={items}
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : (v as T))}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BoolRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label className="text-sm">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

// ---------- the form ----------

export function RequirementsForm({
  value,
  onChange,
  region,
  company,
}: {
  value: RequirementsProfile;
  onChange: (v: RequirementsProfile) => void;
  region: Region;
  company: MyCompany;
}) {
  const set = <K extends keyof RequirementsProfile>(
    key: K,
    v: RequirementsProfile[K],
  ) => onChange({ ...value, [key]: v });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Everything below is optional — it captures what the JD doesn&apos;t say.
        Each section is either a <strong>preference</strong> (affects scoring)
        or a <strong>hard filter</strong> (can reject). Candidates whose resume
        doesn&apos;t answer a hard filter are never auto-rejected — they&apos;re
        flagged for your review.
      </p>

      {/* 1. Role & context */}
      <Section title="Role & context" hint="Seniority, openings, industry background">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Seniority">
            <EnumSelect
              value={value.seniority}
              onChange={(v) => set("seniority", v)}
              options={[
                ["junior", "Junior"],
                ["mid", "Mid"],
                ["senior", "Senior"],
                ["lead", "Lead"],
                ["manager", "Manager"],
              ]}
            />
          </Field>
          <Field label="Openings">
            <NumInput value={value.openings} onChange={(v) => set("openings", v)} min={1} />
          </Field>
          <Field label="Target join date">
            <Input
              type="date"
              value={value.target_join_date ?? ""}
              onChange={(e) => set("target_join_date", e.target.value || null)}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role type">
            <EnumSelect
              value={value.role_type}
              onChange={(v) => set("role_type", v ?? "either")}
              options={[
                ["ic", "Individual contributor"],
                ["manager", "People manager"],
                ["either", "Either"],
              ]}
              placeholder="Either"
            />
          </Field>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-sm">Required industry background</Label>
              <ModeSelect
                value={value.industries_mode}
                onChange={(m) => set("industries_mode", m)}
              />
            </div>
            <ListInput
              value={value.industries}
              onChange={(v) => set("industries", v)}
              placeholder={"e.g. fintech\nhealthcare"}
            />
          </div>
        </div>
      </Section>

      {/* 2. Location & work mode */}
      <Section
        title="Location & work mode"
        hint="Where the candidate must be, and how flexible that is"
        mode={value.location_mode}
        onMode={(m) => set("location_mode", m)}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Work mode">
            <EnumSelect
              value={value.work_mode}
              onChange={(v) => set("work_mode", v)}
              options={[
                ["onsite", "On-site"],
                ["hybrid", "Hybrid"],
                ["remote", "Remote"],
              ]}
            />
          </Field>
          {value.work_mode === "hybrid" && (
            <Field label="Days in office / week">
              <NumInput
                value={value.hybrid_days_per_week}
                onChange={(v) => set("hybrid_days_per_week", v)}
                min={1}
                max={6}
              />
            </Field>
          )}
          {value.work_mode !== "remote" && (
            <Field label="Office location">
              <Input
                placeholder={company.office_locations[0] ?? "City, area"}
                value={value.office_location ?? ""}
                onChange={(e) => set("office_location", e.target.value || null)}
              />
            </Field>
          )}
        </div>

        {value.work_mode !== "remote" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Commute rule">
              <EnumSelect
                value={value.commute_rule}
                onChange={(v) => set("commute_rule", v)}
                options={[
                  ["same_city", "Same city only"],
                  ["metro_area", "Same metro area (e.g. Mumbai ↔ Thane)"],
                  ["radius_km", "Within radius (km)"],
                ]}
              />
            </Field>
            {value.commute_rule === "radius_km" && (
              <Field label="Radius (km)">
                <NumInput
                  value={value.commute_radius_km}
                  onChange={(v) => set("commute_radius_km", v)}
                  min={1}
                />
              </Field>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <BoolRow
            label="Relocation acceptable"
            hint="Candidates willing to relocate pass the location filter"
            value={value.relocation_acceptable}
            onChange={(v) => set("relocation_acceptable", v)}
          />
          <BoolRow
            label="Relocation assistance offered"
            value={value.relocation_assistance}
            onChange={(v) => set("relocation_assistance", v)}
          />
        </div>

        {value.work_mode === "remote" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Remote scope">
              <EnumSelect
                value={value.remote_scope}
                onChange={(v) => set("remote_scope", v)}
                options={[
                  ["in_country", "Within country only"],
                  ["international", "International OK"],
                ]}
              />
            </Field>
            <Field label="Timezone overlap with">
              <Input
                placeholder="e.g. America/New_York"
                value={value.timezone_overlap_zone ?? ""}
                onChange={(e) => set("timezone_overlap_zone", e.target.value || null)}
              />
            </Field>
            <Field label="Overlap hours required">
              <NumInput
                value={value.timezone_overlap_hours}
                onChange={(v) => set("timezone_overlap_hours", v)}
                min={1}
                max={12}
              />
            </Field>
          </div>
        )}
      </Section>

      {/* 3. Work authorization */}
      <Section
        title="Work authorization"
        hint={
          region === "IN"
            ? "Rarely applies to local Indian hires — leave off unless relevant"
            : "The biggest gap resumes leave open — set this explicitly"
        }
        mode={value.work_auth_mode}
        onMode={(m) => set("work_auth_mode", m)}
      >
        {region === "US" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <BoolRow
              label="Must be authorized to work in the US"
              value={value.us_work_auth_required ?? false}
              onChange={(v) => set("us_work_auth_required", v)}
            />
            <Field label="Visa sponsorship">
              <EnumSelect
                value={value.us_sponsorship}
                onChange={(v) => set("us_sponsorship", v)}
                options={[
                  ["none", "No sponsorship"],
                  ["transfer_only", "H-1B transfer only"],
                  ["new_ok", "New sponsorship OK"],
                ]}
              />
            </Field>
            <BoolRow
              label="OPT / CPT candidates acceptable"
              value={value.us_opt_cpt_ok ?? false}
              onChange={(v) => set("us_opt_cpt_ok", v)}
            />
            <Field label="Employment type">
              <EnumSelect
                value={value.us_employment_type}
                onChange={(v) => set("us_employment_type", v)}
                options={[
                  ["w2", "W-2 only"],
                  ["c2c", "C2C acceptable"],
                  ["1099", "1099 acceptable"],
                  ["any", "Any"],
                ]}
              />
            </Field>
          </div>
        )}
        {region === "UK" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <BoolRow
              label="Right to work in the UK required"
              value={value.uk_right_to_work_required ?? false}
              onChange={(v) => set("uk_right_to_work_required", v)}
            />
            <BoolRow
              label="Skilled Worker visa sponsorship available"
              hint="Requires the company to be a licensed sponsor"
              value={value.uk_sponsor_available ?? false}
              onChange={(v) => set("uk_sponsor_available", v)}
            />
          </div>
        )}
        {region === "IN" && (
          <p className="text-sm text-muted-foreground">
            No work-authorization questions apply for local hires in India.
          </p>
        )}
      </Section>

      {/* 4. Experience */}
      <Section
        title="Experience"
        hint="Minimums are hard; target range is soft (avoids age-proxy filtering)"
        mode={value.experience_mode}
        onMode={(m) => set("experience_mode", m)}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum years (hard)">
            <NumInput
              value={value.min_years_experience}
              onChange={(v) => set("min_years_experience", v)}
              min={0}
            />
          </Field>
          <Field label="Target range from (soft)">
            <NumInput
              value={value.target_years_min}
              onChange={(v) => set("target_years_min", v)}
              min={0}
            />
          </Field>
          <Field label="Target range to (soft)">
            <NumInput
              value={value.target_years_max}
              onChange={(v) => set("target_years_max", v)}
              min={0}
            />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="text-sm">Hands-on requirements (one per line)</Label>
            <ModeSelect
              value={value.hands_on_mode}
              onChange={(m) => set("hands_on_mode", m)}
            />
          </div>
          <ListInput
            value={value.hands_on_requirements}
            onChange={(v) => set("hands_on_requirements", v)}
            placeholder={"e.g. Has shipped a production mobile app\nHas owned a P&L"}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company-stage preference (soft)">
            <EnumSelect
              value={value.company_stage_pref}
              onChange={(v) => set("company_stage_pref", v)}
              options={[
                ["startup", "Startup"],
                ["mnc", "MNC"],
                ["agency", "Agency"],
                ["enterprise", "Enterprise"],
              ]}
            />
          </Field>
          <BoolRow
            label="Flag employment gaps for review"
            hint="Never auto-rejects"
            value={value.flag_employment_gaps}
            onChange={(v) => set("flag_employment_gaps", v)}
          />
        </div>
      </Section>

      {/* 5. Skills & qualifications */}
      <Section title="Skills & qualifications" hint="Must-haves, certifications, education">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="text-sm">
              Must-have skills (one per line, optionally &quot;skill: years&quot;)
            </Label>
            <ModeSelect
              value={value.must_have_skills_mode}
              onChange={(m) => set("must_have_skills_mode", m)}
            />
          </div>
          <ListInput
            value={value.must_have_skills.map((s) =>
              s.min_years != null ? `${s.skill}: ${s.min_years}` : s.skill,
            )}
            onChange={(lines) =>
              set(
                "must_have_skills",
                lines.map((line) => {
                  const m = line.match(/^(.*?):\s*(\d+(?:\.\d+)?)\s*$/);
                  return m
                    ? { skill: m[1].trim(), min_years: Number(m[2]) }
                    : { skill: line.trim(), min_years: null };
                }),
              )
            }
            placeholder={"React: 2\nSEO"}
            rows={3}
          />
        </div>
        <Field label="Nice-to-have skills (one per line)">
          <ListInput
            value={value.nice_to_have_skills}
            onChange={(v) => set("nice_to_have_skills", v)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-sm">Certifications</Label>
              <ModeSelect
                value={value.certifications_mode}
                onChange={(m) => set("certifications_mode", m)}
              />
            </div>
            <ListInput
              value={value.certifications}
              onChange={(v) => set("certifications", v)}
              placeholder={region === "UK" ? "e.g. ACCA" : region === "US" ? "e.g. CPA, PMP" : "e.g. CA"}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-sm">Licenses</Label>
              <ModeSelect
                value={value.licenses_mode}
                onChange={(m) => set("licenses_mode", m)}
              />
            </div>
            <ListInput
              value={value.licenses}
              onChange={(v) => set("licenses", v)}
              placeholder="e.g. Driving licence"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <BoolRow
            label="Portfolio / GitHub required (scoring only)"
            value={value.portfolio_required}
            onChange={(v) => set("portfolio_required", v)}
          />
        </div>
        <div className="rounded-md border p-3">
          <div className="mb-3 flex items-center justify-between">
            <Label className="text-sm font-medium">Education</Label>
            <ModeSelect
              value={value.education_mode}
              onChange={(m) => set("education_mode", m)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <BoolRow
              label="Degree required"
              value={value.education_degree_required}
              onChange={(v) => set("education_degree_required", v)}
            />
            <Field label="Field of study">
              <Input
                placeholder="e.g. Computer Science"
                value={value.education_field ?? ""}
                onChange={(e) => set("education_field", e.target.value || null)}
              />
            </Field>
            <BoolRow
              label="Equivalent experience OK"
              value={value.education_equivalent_ok}
              onChange={(v) => set("education_equivalent_ok", v)}
            />
          </div>
        </div>
      </Section>

      {/* 6. Compensation */}
      <Section
        title="Compensation"
        hint={
          region === "IN"
            ? "Annual CTC. Over-budget candidates are flagged, never rejected."
            : "Base salary. Expectations only — salary history is never extracted." +
              (region === "US" ? " (Salary-history bans apply in many US states.)" : "")
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency">
            <EnumSelect
              value={value.budget_currency}
              onChange={(v) => set("budget_currency", v)}
              options={[
                ["INR", "INR (₹, CTC)"],
                ["USD", "USD ($)"],
                ["GBP", "GBP (£)"],
              ]}
            />
          </Field>
          <Field label="Budget from">
            <NumInput value={value.budget_min} onChange={(v) => set("budget_min", v)} min={0} />
          </Field>
          <Field label="Budget to">
            <NumInput value={value.budget_max} onChange={(v) => set("budget_max", v)} min={0} />
          </Field>
        </div>
        <BoolRow
          label="Flag candidates whose expectations exceed budget"
          hint="Flag for review only — expectations are negotiable"
          value={value.flag_over_budget}
          onChange={(v) => set("flag_over_budget", v)}
        />
      </Section>

      {/* 7. Availability & logistics */}
      <Section
        title="Availability & logistics"
        hint={region === "IN" ? "Notice period is often the #1 criterion in India" : "Notice period, shift, contract type"}
        mode={value.availability_mode}
        onMode={(m) => set("availability_mode", m)}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max notice period (days)">
            <NumInput
              value={value.max_notice_days}
              onChange={(v) => set("max_notice_days", v)}
              min={0}
              max={365}
            />
          </Field>
          <Field label="Shift">
            <EnumSelect
              value={value.shift}
              onChange={(v) => set("shift", v)}
              options={[
                ["day", "Day"],
                ["night", "Night"],
                ["rotational", "Rotational"],
                ["on_call", "On-call"],
              ]}
            />
          </Field>
          <Field label="Contract type">
            <EnumSelect
              value={value.contract_type}
              onChange={(v) => set("contract_type", v)}
              options={[
                ["permanent", "Permanent"],
                ["fixed_term", "Fixed term"],
                ["contract", "Contract"],
                ["contract_to_hire", "Contract-to-hire"],
              ]}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <BoolRow
            label="Immediate joiners only"
            value={value.immediate_joiners_only}
            onChange={(v) => set("immediate_joiners_only", v)}
          />
          <Field label="Max travel % (soft)">
            <NumInput
              value={value.travel_percent_max}
              onChange={(v) => set("travel_percent_max", v)}
              min={0}
              max={100}
            />
          </Field>
        </div>
      </Section>

      {/* 8. Language */}
      <Section
        title="Language & communication"
        mode={value.language_mode}
        onMode={(m) => set("language_mode", m)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="English (spoken)">
            <EnumSelect
              value={value.english_spoken}
              onChange={(v) => set("english_spoken", v)}
              options={[
                ["basic", "Basic"],
                ["professional", "Professional"],
                ["fluent", "Fluent"],
              ]}
            />
          </Field>
          <Field label="English (written)">
            <EnumSelect
              value={value.english_written}
              onChange={(v) => set("english_written", v)}
              options={[
                ["basic", "Basic"],
                ["professional", "Professional"],
                ["fluent", "Fluent"],
              ]}
            />
          </Field>
        </div>
        <Field label="Additional languages (one per line)">
          <ListInput
            value={value.other_languages}
            onChange={(v) => set("other_languages", v)}
            placeholder={region === "IN" ? "e.g. Marathi\nHindi" : "e.g. Spanish"}
          />
        </Field>
      </Section>

      {/* 9. Pipeline behavior */}
      <Section title="Scoring & pipeline" hint="Threshold band, weights, dealbreakers">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="'Maybe' band below threshold (points)">
            <NumInput
              value={value.maybe_band}
              onChange={(v) => set("maybe_band", v ?? 10)}
              min={0}
              max={30}
            />
          </Field>
          <Field label="Scoring emphasis">
            <EnumSelect
              value={value.weight_preset}
              onChange={(v) => set("weight_preset", v ?? "balanced")}
              options={[
                ["balanced", "Balanced (40/25/15/10/10)"],
                ["skills_first", "Skills first (50/20/10/5/15)"],
                ["experience_first", "Experience first (30/20/30/10/10)"],
              ]}
              placeholder="Balanced"
            />
          </Field>
          <Field label="Max shortlist size">
            <NumInput
              value={value.max_shortlist}
              onChange={(v) => set("max_shortlist", v)}
              min={1}
            />
          </Field>
        </div>
        <Field label="Dealbreakers (free text)">
          <Textarea
            rows={2}
            placeholder="e.g. Currently employed at a direct competitor of X"
            value={value.dealbreakers ?? ""}
            onChange={(e) => set("dealbreakers", e.target.value || null)}
          />
        </Field>
      </Section>
    </div>
  );
}
