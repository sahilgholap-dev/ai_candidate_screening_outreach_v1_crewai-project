# Watched-Folder Resume Ingestion — Design

Date: 2026-07-29
Status: Approved

## Goal

Let a recruiter bind a local folder to a campaign at creation time. While the
app is open in the browser, new resumes dropped into that folder are uploaded
and screened automatically. Manual select-and-upload remains available; the
recruiter chooses one intake mode per campaign.

## Decisions made during brainstorming

- **Folder watching happens in the browser** via the File System Access API
  (Chrome/Edge). A packaged always-on desktop agent (.exe) is a later phase;
  the backend endpoints built here are agent-ready as-is.
- **1:1 binding**: the selected folder belongs to exactly one campaign. No
  shared roots or subfolder schemes. Binding one folder to two campaigns is
  rejected client-side via `FileSystemHandle.isSameEntry()`.
- **Zero-resume campaigns are allowed** in folder mode: the campaign waits in
  a new `Watching` status until files appear.
- **Initial folder contents = normal batch**, identical to today's upload flow.
- **After that, incremental**: each new resume is screened as it arrives, one
  by one (`BATCH_SIZE = 1` already), against the campaign's stored
  `unified_profile` checklist. Existing candidates and scores are untouched.
- **Watching only while a tab is open** is acceptable for now. Catch-up after
  the browser was closed is automatic via the server-side manifest diff.

## Backend

### Data model (Alembic migration)

- `Campaign.intake_mode`: `"upload"` (default) | `"folder"`.
- `Campaign.folder_name`: display-only string (browsers never expose full
  paths), nullable.
- `Candidate.content_hash`: SHA-256 hex of the file bytes; nullable for
  legacy rows; unique per `(campaign_id, content_hash)`.

### API changes

- `POST /api/campaigns`: `resume_files` becomes optional when
  `intake_mode="folder"`. Zero-resume folder campaigns get status `Watching`
  and are NOT enqueued. With initial files the flow is unchanged (Queued →
  full run). `content_hash` computed server-side for every resume stored.
- `GET /api/campaigns/{id}/resume-manifest` (new): returns
  `[{content_hash, original_filename}]` for the campaign. Company-scoped auth
  like other campaign endpoints.
- `POST /api/campaigns/{id}/resumes` (new): multipart, 1..n files. Validates
  exactly like campaign creation (extension, size, MAX_RESUMES_PER_CAMPAIGN
  cap across the campaign). Files whose hash already exists in the campaign
  are skipped, not errors. Response: `{added: [...], skipped: [...]}`.
  Creates Candidate rows (parsed in the run, as today), writes the files to
  the campaign upload dir, audit-logs `campaign.resumes_added`
  (count + intake source), and enqueues:
  - status not in {`Queued`, `Processing`} → set `Queued`;
  - status `Processing` → do nothing here; see runner self-requeue below.
  - Works for both intake modes (manual campaigns gain "add more resumes").

### Runner changes (`pipeline/runner.py`)

- Contact-dedup `seen` map is built from ALL candidates (a new resume
  duplicating an old candidate is still marked `Duplicate`), but
  `to_process` only includes candidates not yet screened
  (`score is None and no recommendation`).
- At the end of `run_campaign`, if unscreened candidates remain (arrived
  mid-run), re-queue the campaign (goes to the back of the line).
- Stored `unified_profile` is reused unchanged — new candidates score against
  the byte-identical rubric of the original batch.
- Final report/export regeneration includes all candidates (old + new).

### Queue semantics (unchanged, for the record)

Single worker, oldest-first, one campaign at a time. Two campaigns receiving
files concurrently upload in parallel but screen serially. Multiple files
landing in one queued campaign are scooped up by a single run.

## Frontend

### New-campaign page

- Intake selector: "Upload resume files" (current flow, default) vs
  "Watch a folder". Folder option disabled with a hint on browsers without
  `showDirectoryPicker` (Firefox/Safari).
- Folder mode: `showDirectoryPicker()` → scan eligible files (same extension
  list as backend validation) → create campaign with those files (possibly
  zero) and `intake_mode=folder`, `folder_name=handle.name` → persist the
  directory handle in IndexedDB keyed by campaign id → reject binding if
  `isSameEntry()` matches another campaign's stored handle.

### Watcher (dashboard-level hook/provider)

- Every ~15 s per bound campaign with granted permission:
  1. List folder files (filtered by extension).
  2. Skip files whose name+size+lastModified match the local "already
     handled" cache; a new file must have stable size+mtime across two ticks
     before upload (guards against half-written downloads).
  3. Hash remaining files with `crypto.subtle.digest`.
  4. Diff against `GET resume-manifest`; POST genuinely new ones.
  5. Remember rejected files (name+size) client-side so they aren't retried
     forever; surface a dismissible warning.
- Per-campaign status in the UI: watching / last-checked time / synced count.
- Permission re-grant after browser restart requires a user gesture: show a
  "Resume watching" banner per campaign; one click re-activates, then the
  manifest diff catches up anything missed while the browser was closed.
- On rerun (campaign clone) the binding transfers to the newest clone; the
  original stops being watched.

## Error handling

- Offline/API failure → back off, retry next tick; manifest diff means
  nothing is ever lost or duplicated.
- Invalid type / oversize → skipped with visible warning, never retried.
- Server restart mid-run → existing `requeue_stuck_campaigns` plus the
  only-unscreened filter make restarts safe (no double scoring).
- Outreach remains draft-only; every folder-sourced addition is audit-logged.

## Testing

- Backend (pytest): zero-resume folder creation; Watching status not
  enqueued; manifest endpoint; add-resumes hash dedup + cap + validation;
  `to_process` skips screened candidates; requeue-when-Processing path;
  duplicate-contact detection across old/new candidates.
- Frontend: unit test for the diff/stability logic; typecheck; manual
  end-to-end in Chrome (File System Access API has no meaningful headless
  test story).

## Out of scope (later phases)

- Packaged desktop agent (.exe, auto-start, tray) — reuses these endpoints.
- Multi-worker queue parallelism (Postgres SKIP LOCKED upgrade path noted in
  queue_worker.py).
