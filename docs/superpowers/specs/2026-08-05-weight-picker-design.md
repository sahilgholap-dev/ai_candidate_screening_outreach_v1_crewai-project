# Scoring priorities picker — design

**Date:** 2026-08-05
**Status:** Approved (user, in-session)
**Scope:** Frontend only. No backend changes.

## Problem

The backend has supported per-campaign scoring weights since Phase 3
(`weight_preset` + `custom_weights` on `RequirementsProfileV1`, resolved by
`effective_weights()` and applied in `pipeline/scoring.py`), but the campaign
form never exposes them: `frontend/src/lib/requirements.ts` hardcodes
`weight_preset: "balanced"`, so every UI-created campaign scores with
40/25/15/10/10. Recruiters cannot reach the capability that already exists.

## Decision

Add a **"Scoring priorities"** accordion section to the new-campaign form
exposing the three named presets plus a custom five-number editor
(user-selected option: "Presets + custom").

## UI

- New `AccordionSection` titled **"Scoring priorities"**, pill `pref`, not
  `defaultOpen`, placed inside the "What matters beyond the JD" `CardBox`
  directly after "Must-have skills & credentials".
- Section copy (recruiter language, no scoring jargon): candidates are scored
  out of 100 across five areas; choose what matters most for this role.
  Balanced applies if untouched.
- Four selectable cards in a grid, reusing the existing button-card pattern
  from this page (database-mode cards: `rounded-lg border p-4 text-left`,
  selected = `border-primary bg-verdict-pass-soft`):
  - **Balanced** (default) — "Skills matter most, but nothing dominates."
    Required skills 40 · Must-haves 25 · Experience 15 · Education 10 ·
    Nice-to-haves 10.
  - **Skills-first** — 50/20/10/5/15.
  - **Experience-first** — 30/20/30/10/10.
  - **Custom** — reveals the editor below.
- Custom editor: five integer inputs (0–100), one per area, using the
  recruiter-facing labels above. Seeded from whichever preset was active when
  Custom is selected. A live total chip shows green "Total: 100 ✓" when valid,
  amber "Total: N — must equal 100" otherwise.
- Switching from Custom back to a named preset sets `custom_weights` to null
  (edits discarded). Re-selecting Custom re-seeds from the current preset.

## Wiring

- `WEIGHT_PRESETS` const added to `frontend/src/lib/requirements.ts`
  mirroring the backend values in `schemas/requirements.py` (that file's
  stated role is mirroring the backend schema; server re-validates
  authoritatively).
- The section writes through the existing `set()` helper:
  `set("weight_preset", …)` and `set("custom_weights", …)`. Both fields are
  already in the `RequirementsProfile` type and already serialized into the
  `requirements` form field on submit — no payload changes.

## Validation

- Client, in `submit()`: when `weight_preset === "custom"`, every value must
  be an integer 0–100 and the five must sum to exactly 100; otherwise block
  submit with the same "must equal 100" message the chip shows.
- Backend re-validates via the existing `CustomWeights` model validator
  (422 on mismatch). No backend changes.

## Out of scope

- Editing weights on an existing campaign (PATCH + re-score endpoint) — a
  possible follow-up; the stored per-candidate `judgment_record` makes
  re-scoring pure arithmetic.
- Exposing threshold / maybe-band (deliberately agent-internal in this UI).
- Backend/schema changes of any kind.

## Verification

- `tsc`, ESLint, and production build pass (the project's frontend gate).
- Manual: create campaigns with each preset and a custom set; confirm the
  stored `campaign.requirements` carries the chosen values and the pipeline
  scores with them; confirm invalid custom sums are blocked client-side and
  would 422 server-side.
- Per `frontend/AGENTS.md`, consult `node_modules/next/dist/docs/` before
  writing code.
