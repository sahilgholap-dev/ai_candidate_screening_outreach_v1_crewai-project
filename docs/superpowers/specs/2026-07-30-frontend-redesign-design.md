# Frontend Redesign — NEXUS Talent Match Client UI

Date: 2026-07-30
Status: Approved
Reference: `HR_Agent_Client_UI_Mockup_v1.html` (repo root) — replicate exactly,
EXCEPT the Workspace settings page (kept on our own content) and the mockup's
design-note callouts / fake data / mockup-jumper, which are mockup-only.

## Goal

Rebuild the client-facing frontend to match the mockup's design: dark-green
sidebar shell, emerald accent, "search" language instead of "campaign",
fit bands instead of raw scores, human-readable progress, and a
review → outreach-queue → sent workflow. Add the minimum backend support to
make every element real (no fake data).

## Decisions (from brainstorming)

- "Where we'll search" card keeps mockup styling but contains our REAL intake
  (Upload files / Watch a folder). No fake ATS card.
- "Approve & send" is Phase-1 approve-only: records reviewer + timestamp +
  final edited message on the candidate and in the audit log. No real email.
- New form fields are wired into the pipeline (schema + prompts), not
  capture-only.
- Admin pages: new shell/colors only; content layouts unchanged.
- Workspace settings page: our own content (company profile, read-only) in the
  new shell — NOT the mockup layout.
- Omitted: real sending, ATS integration, LinkedIn tab (render disabled
  "Phase 2"), reply tracking, regenerate-draft (no backing endpoint).

## Design system (from mockup CSS)

Tokens → Tailwind theme (globals.css):
- nav-bg `#0A1F1A`, nav-hover `#143329`, accent `#10B981`, accent-hover
  `#059669`, accent-soft `#D1FAE5`, page-bg `#F8FAFC`, card-bg `#FFF`,
  border `#E2E8F0`, border-strong `#CBD5E1`, text `#0F172A`, muted `#64748B`,
  light `#94A3B8`, danger `#EF4444`/`#FEE2E2`, amber `#F59E0B`/`#FEF3C7`,
  blue `#3B82F6`/`#DBEAFE`, gray-soft `#F1F5F9`.
- Base font 14px system stack; cards radius 10px, subtle shadow; buttons 6px
  radius; pills 999px.
- Shell: fixed 240px dark sidebar (brand block, section labels, nav items
  with icon + optional badge, user box with avatar + signout) + white sticky
  topbar (page title/subtitle left, action buttons right) + content column
  max-width 1200px.

## Screens

### Login (+ reset-password)
Dark gradient page (`135deg, #0A1F1A → #143329`), centered white card
(max-width 400px): NEXUS logo-line, "Talent Match", "Sign in to your
workspace", email/password, full-width primary button, muted footer "New
workspace? Get in touch with your MasterTech onboarder." Reset-password page
uses the same card style.

### Search library (route: /dashboard)
- Topbar: "Search library" / "All talent searches for {company}", primary
  "+ Start new search".
- Filter chips: All searches · Active · Awaiting review · Completed ·
  Archived→(we use Cancelled).
- Table columns: Search name (bold) · Role · Status (colored dot + label) ·
  Candidates reviewed ("N of M") · Recommended (count; "· K approved" muted
  suffix when K>0) · Last activity (relative time).
- Status mapping: Running = Queued/Processing/Watching(pulse dot blue;
  Watching shows "Watching folder"); Awaiting review = Completed with
  recommended candidates still review_status=pending (amber); Completed =
  Completed otherwise (green); Cancelled (gray); Error (red, not in mockup —
  reuse danger color).
- Row click → search detail (progress or results by status).

### Start new search (route: /dashboard/campaigns/new)
- Topbar actions: Cancel · "Start search" (primary).
- Card "The role": Search name / Role title / Openings (3-col row);
  JD file-drop zone (drag + click, PDF/DOCX/TXT) | right column Urgency
  select (Standard/High/Critical, view-only pacing hint) + Target start date.
- Card "Where we'll search": our intake. Toggle: "Upload resume files" /
  "Watch a folder" (folder disabled off-Chromium with hint). Upload mode:
  file-drop zone, multiple. Folder mode: choose-folder button + status line.
  Info banner (blue) explaining folder watching only syncs while app is open.
- Card "What matters beyond the JD": accordion sections, each head =
  title + desc left, mode pill + chevron right; expanded by default for the
  first three, collapsed for the rest.
  1. Team & seniority (Preference): seniority select (existing enum),
     industry chips (existing industries), team description text →
     `team_context` (used in outreach).
  2. Location & work mode (Hard requirement): required location chips
     (existing office_location — single value + hint), work mode select,
     commute tolerance select, relocation select. Maps to existing location
     fields; mode pill reflects location_mode (default hard_filter).
  3. Must-have skills & credentials (Preference): must-have chips (strong
     style), nice-to-have chips, required credentials chips (licenses →
     hard), education select. Maps to existing fields; must_have_skills_mode
     drives the pill.
  4. Compensation context (Flag only): min/max, currency select (existing
     budget fields; flag_over_budget stays true).
  5. Availability & start date (Preference): max notice select, travel
     select, shift select (existing fields).
  6. What makes someone thrive here (Preference): culture textarea →
     `culture_text`; "Signals to look for" chips → `positive_signals`;
     "Signals that would concern you" chips → `concern_signals`.
  7. Absolute dealbreakers (Hard requirement): textarea, one per line
     (existing `dealbreakers`).
- Region: not shown; defaults to company default_region. Threshold: not
  shown; company default. (Score/threshold are agent-internal.)
- Validation: name + role title + JD required; upload mode needs ≥1 resume.

### Progress (campaign detail when status ∈ Watching/Queued/Processing/Cancelled-mid)
- Topbar: search name / "Search in progress"; danger "Cancel search".
- Hero: STATUS label ("WORKING"/"QUEUED"/"WATCHING FOLDER"), human line
  ("Scoring candidate N of M against {company}'s requirements"), progress
  bar (processed/total), stats row (scored count · est. remaining when
  computable from poll deltas · recommended so far).
- Stages grid (4): 1 Reading the JD (done when unified_profile exists or any
  candidate scored), 2 Parsing resumes (report unreadable count if any),
  3 Scoring & ranking (active while processing), 4 Drafting outreach
  (described as part of scoring — done at completion).
- Cancel: POST cancel → status Cancelled, partial results kept, page flips
  to results view with a "cancelled" banner.

### Results (campaign detail when Completed/Cancelled/Error with candidates)
- Topbar: name / "M candidates reviewed · K recommended · Completed X ago";
  actions: "↓ Export to Excel" (existing CSV) · "Review outreach drafts →".
- Band strip: 4 cards (Ideal/Good/Moderate/Not a Fit) with top color bar,
  count, one-line description; click filters the list; active card outlined.
- Filter bar: search input + chips (All K recommended · Not yet reviewed ·
  Approved · Over budget · Flagged).
- Candidate rows (grid 40/90/1fr/1fr/130/100): rank # · band tag · name +
  meta (current title/company from resume if available; else filename ·
  years) · "Why they match" 2-line rationale preview · signals column
  (strong culture match ◆ accent / over budget £ amber / flags) · hover
  actions (✓ approve, × reject).
- Error state keeps existing retry affordance, restyled.

### Candidate drawer (overlay on results)
- 560px right slide-in + backdrop. Head: band tag, name, meta.
- Score panel: big score/100 + "why" summary (from rationale).
- "How the score was reached": rubric rows from `judgments` (bucket label,
  justification line, points/cap; total row with arithmetic + compliance
  line).
- Strengths (accent items, ✓) / "Gaps you might weigh" (gray items, –).
- needs_info renders as an amber banner listing unverified filters.
- Sticky actions: Reject · Mark for later · Approve for outreach → (primary,
  wide).

### Outreach queue (route: /dashboard/outreach)
- Topbar: "Outreach queue" / "N candidates approved and awaiting a message
  from you"; action "Approve & send all" (each passes placeholder check).
- Layout 320px list + detail. List item: name + "{role} · {band}".
- Detail: tabs Email / SMS / LinkedIn (Phase 2, disabled). Email preview:
  locked From (signed-in user email) / To (candidate email if parsed, else
  "on file") / Subject; body contenteditable seeded from email_draft.
  SMS tab: textarea-style preview of sms_draft.
- Footer: hint text + actions: Skip this candidate · Approve & send now
  (primary). Placeholder guard: sending blocked while /\[[^\]]+\]/ matches
  body; offending tokens highlighted via warning text.
- Sidebar nav badge shows queue count.

### Sent outreach (route: /dashboard/outreach/sent)
Table: Candidate · Search · Sent (relative) · Sent by. (No Response column —
that's Phase 2 reply tracking.) Data = real send records.

### Workspace settings (route: /dashboard/settings) — NOT mockup layout
Read-only card with our real company profile (name, region, default
threshold, office locations, recruiter signature, tone notes, retention) in
new-shell styling, plus the "changes go through your MasterTech onboarder"
subtitle.

### Admin (existing routes)
Same dark sidebar + topbar + tokens; page content layouts unchanged.

## Band mapping (backend-computed)

- Not a Fit: recommendation in {Reject, Reject (Hard Filter), Duplicate,
  Needs Review} or hard_filter_failed.
- Moderate: recommendation == Maybe.
- Ideal: recommendation == Shortlist AND score >= threshold + 15.
- Good: remaining Shortlist.
Helper `band_for(candidate, threshold)` in backend; serialized as
`candidate.band`; also drives "recommended" counts (Ideal+Good).

## Backend changes

### Data model (Alembic)
- Candidate.review_status: TEXT default 'pending'
  ('pending'|'approved'|'rejected'|'later'). Existing outreach_approved=True
  rows migrate to 'approved'; column outreach_approved dropped.
- Candidate.sent_at (DateTime, nullable), sent_by (String, nullable — user
  email), sent_email (Text), sent_sms (Text).

### Requirements schema (RequirementsProfileV1) — new optional fields
- role_title: str|None (≤200)
- urgency: 'standard'|'high'|'critical'|None (view-only pacing)
- team_context: str|None (≤1000) → outreach prompt color
- culture_text: str|None (≤2000) → scoring qualitative signal + outreach voice
- positive_signals: list[str] → scoring signal ("strong culture match" flag
  when matched; prompt instructs flags list to include 'culture_match')
- concern_signals: list[str] → scoring signal (flag 'culture_concern')
Prompt wiring in prompt_builder.py: culture/signals block added to extra
rules (evaluate as evidence-grounded qualitative signals, NEVER protected
attributes; add flags) and to outreach context (team_context, culture_text
shape voice).

### Endpoints
- GET /api/campaigns — add per-row: role_title (from requirements), counts
  {total, processed, recommended, approved, pending_review}, intake_mode,
  folder_name, urgency, finished_at/created_at for "last activity".
- PATCH /api/campaigns/{id}/candidates/{cid} — accepts review_status
  transitions (pending↔approved/rejected/later); keeps existing
  draft-editing behavior; audit-logs status changes.
- POST /api/campaigns/{id}/candidates/{cid}/send — body {email_body,
  sms_body|null}: requires review_status='approved' and no [placeholder]
  tokens (422 otherwise); sets sent_at/sent_by/sent_email/sent_sms;
  audit-logs 'outreach.sent' with reviewer + content hash.
- GET /api/outreach/queue — company-scoped candidates review_status=
  'approved' AND sent_at IS NULL, with campaign name/role/band + drafts.
- GET /api/outreach/sent — sent_at NOT NULL, newest first.
- POST /api/campaigns/{id}/cancel — allowed from Watching/Queued/Processing;
  sets status='Cancelled', audit-logs. Runner: between candidates, re-read
  campaign status; if 'Cancelled' (or campaign deleted), stop gracefully,
  keep partial results, skip self-requeue. Cancelled campaigns can't be
  re-queued by add-resumes (folder watcher bindings for them are dropped by
  the existing alive-check only on delete — cancel keeps the campaign
  visible; add-resumes on a Cancelled campaign returns 409).
- Existing candidate PATCH consumers (current UI) are being replaced in the
  same release, so the outreach_approved field can be dropped without a
  compatibility shim.

## Frontend structure

- globals.css: new token palette (light theme only, matching mockup).
- components/shell.tsx: rebuilt (sidebar + topbar contract:
  {title, subtitle, actions, children}); nav config per role
  (company_user: Start new search, Search library, Outreach queue + badge,
  Sent outreach, Workspace settings; platform_admin: existing admin nav).
- New shared components: StatusDot, FilterChip, BandCard, BandTag,
  ModePill, AccordionSection, ChipsInput, FileDrop, ProgressHero,
  CandidateDrawer, EmailPreview.
- lib/bands.ts: band labels/colors/descriptions (single source).
- lib/api.ts: new endpoint helpers + types.
- Existing TanStack Query patterns, /api/backend proxy unchanged.

## Testing

- Backend pytest: band mapping boundaries; review_status transitions +
  invalid transition 422; send happy path + placeholder block + unapproved
  block; queue/sent scoping; cancel from each status + runner abort +
  add-resumes-on-cancelled 409; campaign list counts; new schema fields
  round-trip.
- Frontend: tsc + lint + production build; manual side-by-side pass against
  the mockup per screen.

## Rollout

Single release on main. The old dashboard UI is replaced; no feature flag.
DB migration is additive except outreach_approved→review_status conversion.
