# Scoring Priorities Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the backend's per-campaign scoring weights (presets + custom five-number editor) in the new-campaign form.

**Architecture:** Frontend-only. A new "Scoring priorities" accordion section in `frontend/src/app/dashboard/campaigns/new/page.tsx` writes `weight_preset` / `custom_weights` into the existing `RequirementsProfile` state, which is already serialized into the `requirements` form field on submit. Preset values are mirrored from the backend into `frontend/src/lib/requirements.ts`. The backend re-validates authoritatively (`CustomWeights` model validator, 422) — zero backend changes.

**Tech Stack:** Next.js 16.2.11 app router, React 19 client component, TypeScript 5, Tailwind v4, existing local UI primitives (`AccordionSection`, `Field`, `Input`).

**Spec:** `docs/superpowers/specs/2026-08-05-weight-picker-design.md`

## Global Constraints

- No backend changes of any kind.
- Recruiter-facing copy only — never "bucket", "cap", or backend field names in UI text.
- Preset values must mirror `backend/src/ai_candidate_screening_outreach/schemas/requirements.py` exactly: balanced 40/25/15/10/10, skills_first 50/20/10/5/15, experience_first 30/20/30/10/10 (order: required_skills, must_haves, experience, education, preferred_skills).
- Follow the file's existing patterns: local helper components, the button-card selected style `border-primary bg-verdict-pass-soft`, unselected `border-border bg-white hover:border-input`.
- No frontend test runner exists; the verification gate per task is `npx tsc --noEmit`, `npm run lint`, and (final task) `npm run build`, all run from `frontend/`.
- Threshold and maybe-band stay hidden (agent-internal) — do not add them to this section.

---

### Task 1: Preset data in the requirements mirror

**Files:**
- Modify: `frontend/src/lib/requirements.ts` (insert after the `RequirementsProfile` type, i.e. after line 97)

**Interfaces:**
- Consumes: existing `CustomWeights` and `RequirementsProfile` types in the same file.
- Produces (Task 2 and 3 import these): `WEIGHT_PRESETS: Record<"balanced" | "skills_first" | "experience_first", CustomWeights>`, `WEIGHT_LABELS: Record<keyof CustomWeights, string>`, `weightsTotal(w: CustomWeights): number`.

- [ ] **Step 1: Add the constants and helper**

Insert after the closing `};` of the `RequirementsProfile` type (line 97), before `defaultRequirements()`:

```ts
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
```

- [ ] **Step 2: Verify types and lint**

Run from `frontend/`: `npx tsc --noEmit` then `npm run lint`
Expected: both exit 0 (unused-export warnings must not appear; ESLint config permits exports without importers).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/requirements.ts
git commit -m "feat: mirror backend weight presets in requirements lib"
```

---

### Task 2: "Scoring priorities" section in the campaign form

**Files:**
- Modify: `frontend/src/app/dashboard/campaigns/new/page.tsx`
  - imports block (lines 30–34)
  - new local component after `InfoBanner` (after line 95)
  - new `AccordionSection` between "Must-have skills & credentials" (closes line 696) and "What makes someone thrive here" (opens line 698)

**Interfaces:**
- Consumes: `WEIGHT_PRESETS`, `WEIGHT_LABELS`, `weightsTotal`, `CustomWeights` from `@/lib/requirements` (Task 1); existing `req` state, `set()` helper, `Field`, `AccordionSection`, `Input`.
- Produces: form state `req.weight_preset` and `req.custom_weights` correctly populated (Task 3 validates them in `submit()`).

- [ ] **Step 1: Extend the requirements import**

Change lines 30–34 from:

```tsx
import {
  defaultRequirements,
  MyCompany,
  RequirementsProfile,
} from "@/lib/requirements";
```

to:

```tsx
import {
  CustomWeights,
  defaultRequirements,
  MyCompany,
  RequirementsProfile,
  WEIGHT_LABELS,
  WEIGHT_PRESETS,
  weightsTotal,
} from "@/lib/requirements";
```

- [ ] **Step 2: Add the preset card data and custom editor component**

Insert after the `InfoBanner` component (after line 95), before `export default function NewSearchPage()`:

```tsx
const PRESET_CARDS: {
  key: RequirementsProfile["weight_preset"];
  title: string;
  blurb: string;
}[] = [
  {
    key: "balanced",
    title: "Balanced",
    blurb: "Skills matter most, but nothing dominates. The default.",
  },
  {
    key: "skills_first",
    title: "Skills-first",
    blurb: "For roles where demonstrated skills outweigh everything else.",
  },
  {
    key: "experience_first",
    title: "Experience-first",
    blurb: "For roles where years of doing the job count as much as skills.",
  },
  {
    key: "custom",
    title: "Custom",
    blurb: "Set the five areas yourself.",
  },
];

function CustomWeightsEditor({
  value,
  onChange,
}: {
  value: CustomWeights;
  onChange: (v: CustomWeights) => void;
}) {
  const total = weightsTotal(value);
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(WEIGHT_LABELS) as (keyof CustomWeights)[]).map((k) => (
          <Field key={k} label={WEIGHT_LABELS[k]}>
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={value[k]}
              onChange={(e) => {
                const n = Math.max(
                  0,
                  Math.min(100, Math.round(Number(e.target.value) || 0)),
                );
                onChange({ ...value, [k]: n });
              }}
            />
          </Field>
        ))}
      </div>
      <p
        className={`mt-3 text-xs font-medium ${
          total === 100 ? "text-emerald-600" : "text-amber-600"
        }`}
      >
        {total === 100 ? "Total: 100 ✓" : `Total: ${total} — must equal 100`}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add the accordion section**

Insert between the closing `</AccordionSection>` of "Must-have skills & credentials" (line 696) and the opening of "What makes someone thrive here" (line 698):

```tsx
        <AccordionSection
          title="Scoring priorities"
          desc="Every candidate is scored out of 100 across five areas. Choose what matters most for this role — Balanced applies if you leave this alone."
          pill="pref"
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PRESET_CARDS.map((p) => {
              const active = req.weight_preset === p.key;
              const weights = p.key === "custom" ? null : WEIGHT_PRESETS[p.key];
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    if (p.key === "custom") {
                      set("weight_preset", "custom");
                      if (!req.custom_weights) {
                        const seed =
                          req.weight_preset === "custom"
                            ? WEIGHT_PRESETS.balanced
                            : WEIGHT_PRESETS[req.weight_preset];
                        set("custom_weights", { ...seed });
                      }
                    } else {
                      set("weight_preset", p.key);
                      set("custom_weights", null);
                    }
                  }}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    active
                      ? "border-primary bg-verdict-pass-soft"
                      : "border-border bg-white hover:border-input"
                  }`}
                >
                  <div className="text-[13.5px] font-semibold">{p.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.blurb}</p>
                  {weights && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {WEIGHT_LABELS.required_skills} {weights.required_skills}{" "}
                      · {WEIGHT_LABELS.must_haves} {weights.must_haves} ·{" "}
                      {WEIGHT_LABELS.experience} {weights.experience} ·{" "}
                      {WEIGHT_LABELS.education} {weights.education} ·{" "}
                      {WEIGHT_LABELS.preferred_skills} {weights.preferred_skills}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          {req.weight_preset === "custom" && req.custom_weights && (
            <CustomWeightsEditor
              value={req.custom_weights}
              onChange={(v) => set("custom_weights", v)}
            />
          )}
        </AccordionSection>
```

Behavior notes locked by the spec: clicking a named preset nulls `custom_weights`; clicking Custom seeds the editor from the preset that was active at that moment (the `req.weight_preset === "custom"` guard only covers the unreachable-in-practice re-click case); switching away and back re-seeds.

- [ ] **Step 4: Verify types and lint**

Run from `frontend/`: `npx tsc --noEmit` then `npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/dashboard/campaigns/new/page.tsx
git commit -m "feat: scoring priorities picker on the new-campaign form"
```

---

### Task 3: Submit validation + full gate

**Files:**
- Modify: `frontend/src/app/dashboard/campaigns/new/page.tsx` — `submit()`, after the dealbreakers check (lines 171–172)

**Interfaces:**
- Consumes: `weightsTotal` (Task 1), `req.weight_preset` / `req.custom_weights` (Task 2).
- Produces: submit blocked with an inline error when Custom weights don't sum to 100; valid payloads unchanged (fields were already serialized).

- [ ] **Step 1: Add the guard**

After:

```tsx
    if (!req.dealbreakers?.trim())
      return setError("Add at least one dealbreaker (with its one-line reason)");
```

insert:

```tsx
    if (
      req.weight_preset === "custom" &&
      (!req.custom_weights || weightsTotal(req.custom_weights) !== 100)
    )
      return setError(
        `Scoring priorities must add up to 100 — currently ${
          req.custom_weights ? weightsTotal(req.custom_weights) : 0
        }. Adjust the Custom values.`,
      );
```

- [ ] **Step 2: Full verification gate**

Run from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npm run build`
Expected: all exit 0; build completes with no new warnings for `dashboard/campaigns/new`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/dashboard/campaigns/new/page.tsx
git commit -m "feat: validate custom scoring weights sum to 100 on submit"
```

---

### Manual verification (after all tasks)

1. `npm run dev` in `frontend/` (backend running or staging proxy configured).
2. Open Start new search → "Scoring priorities": Balanced pre-selected, weight summary lines visible on the three preset cards.
3. Click Custom → editor appears seeded 40/25/15/10/10 with green "Total: 100 ✓". Change Education 10 → 5: chip goes amber "Total: 95 — must equal 100"; Start search shows the inline error. Set Nice-to-have skills to 15: chip green again.
4. Submit a campaign with Skills-first; in devtools confirm the `requirements` form field carries `"weight_preset":"skills_first","custom_weights":null`. Confirm the run scores normally.
5. Click Custom, then Balanced, then Custom again → editor re-seeds from Balanced (edits discarded), matching the spec.
