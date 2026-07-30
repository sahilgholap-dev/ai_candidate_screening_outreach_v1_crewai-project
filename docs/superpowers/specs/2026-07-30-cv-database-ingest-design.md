# CV Database Ingestion — Design & Implementation Plan

Date: 2026-07-30
Status: DRAFT — awaiting Sahil's approval. No implementation yet.

## Goal

A third intake path alongside manual upload and watched folders: clients whose
CVs accumulate in their own systems (a database, an ATS, a storage bucket) get
new resumes flowing into NEXUS automatically and screened against their
searches — without a recruiter touching files.

## Decision 1 — Who connects to whom: we provide the webhook

**Recommendation: NEXUS provides an inbound Ingest API (webhook); the client
pushes to it.** We do NOT connect to client databases.

Why not "we poll their DB":
- **Credentials & liability**: holding read credentials to every client's
  production database is the worst possible security posture for a SaaS —
  one breach on our side exposes all of their candidate PII.
- **Network reality**: client DBs are almost never internet-reachable;
  every onboarding becomes a VPN/allowlist negotiation.
- **Schema chaos**: every client's CV table looks different. A generic
  DB poller means per-client schema mapping work forever.
- **Blame surface**: when their DB is slow or locked, it's our outage.

Why "client pushes to our webhook" wins:
- One stable, documented contract we fully control and version.
- Works for ANY source: a DB trigger, a cron script, an ATS automation rule,
  Zapier/Make, or their backend code.
- Credentials never change hands: they hold one NEXUS API key; we hold
  nothing of theirs.
- Idempotent by design — we already dedup by content hash.

**Onboarding story (matches the "MasterTech onboarder" positioning):** during
the intro call we issue the workspace an API key and hand over either the API
doc or a small **reference connector script** we maintain (Phase 4): a
single-file Python script the client runs on THEIR infrastructure with THEIR
DB credentials; it polls their table/bucket for new rows and POSTs files to
our webhook. Their credentials never leave their network; we still get push
semantics.

## Decision 2 — Buckets: tagged CVs are a deterministic subscription

Clients whose DB already categorizes CVs (a job-title column, an application
bucket) pass that category to the webhook as `bucket` (e.g. "ai-analyst").

- **Search creation:** the pool intake option offers a picker — "All resumes
  (smart-ranked)" or a specific bucket with its live count ("ai-analyst ·
  100 resumes"). Picking a bucket attaches its CVs (deduped, capped) and
  screens them as a normal batch.
- **Live tracking (webhook-triggered, no polling):** the search stays bound
  to the bucket. A new CV arriving with that bucket tag is attached to every
  active search bound to it and incrementally screened immediately — the
  server-side equivalent of folder watching, working with the browser closed.
- An explicit bucket BYPASSES the relevance ranker: the client's own tag
  always beats our inference. Untagged arrivals use Decision 3's ranking.

## Decision 3 — The 10,000-unsorted-CVs problem

The edge case: a client's DB holds ~10k CVs with no role/application tag.
We must never LLM-screen 10k resumes per search (cost: ~10k LLM calls per
search; at even ₹2–4/call that's ruinous, and it's slow).

**Answer: a company-level Resume Pool + a cheap Stage-0 relevance ranker.**

1. **Ingested CVs land in a company-wide pool**, not in any search. Text is
   parsed at ingest; content-hash dedup is company-wide.
2. **Stage 0 (no LLM): relevance ranking.** When a search wants candidates
   from the pool, we rank the entire pool against the search's JD +
   requirements using Postgres full-text search (`tsvector`/`ts_rank` over
   parsed resume text, query built from the JD's extracted skills/title).
   This is a database query — ranking 10k rows costs milliseconds and ₹0.
3. **Cap + threshold:** only the **top N** (recruiter-visible cap, default
   200 = existing MAX_RESUMES_PER_CAMPAIGN) with a minimum relevance score
   get attached as candidates and LLM-screened. The recruiter sees "We found
   412 likely matches in your pool of 10,381 — screening the top 200."
4. **The rest stay in the pool** — searchable by later searches; nothing is
   deleted or rejected. Pool candidates attached to a search flow through the
   EXISTING pipeline unchanged (bands, hard filters, review, outreach).
5. **Continuous mode (like folder-watching, but server-side):** a pool-backed
   search keeps watching. Each newly ingested CV is scored against active
   pool searches; if it clears the relevance bar, it's attached and screened
   incrementally — reusing the incremental-screening + queue machinery built
   for watched folders. This is strictly better than folder watching: it
   works with the browser closed.

Stage-0 is lexical (keywords/title match), not semantic. That's the right
first version: transparent, free, no new infra. An embeddings-based ranker
(better recall for synonym-heavy roles) is a drop-in upgrade later — the
interface (`rank_pool(company_id, search) -> scored ids`) stays the same.
SQLite fallback for local dev: plain keyword-overlap scoring in Python.

## Architecture

```
Client DB/ATS ──(their trigger/cron/connector script)──▶
  POST /api/ingest/resumes  (API key auth)
    ├─ validate + parse text + dedup (company-wide content hash)
    ├─ optional search_id/role_hint → attach directly to that search
    └─ else → resume_pool row
                 └─ Stage-0 scorer ──▶ attach top matches to active
                    pool-backed searches ──▶ existing queue worker
                    (incremental screening, bands, review, outreach)
```

## Data model (new)

- `api_keys`: id, company_id, key_hash (sha256 of secret; plaintext shown
  once at issue), label, created_at, revoked_at, last_used_at.
- `pool_resumes`: id, company_id, original_filename, content_hash
  (unique per company), parsed_text, external_ref (client's ID, optional),
  bucket (optional tag, indexed), received_at, tsv (tsvector, GIN index;
  Postgres only).
- `campaigns.intake_mode` gains value `"pool"`; `campaigns.pool_bucket`
  (nullable — set = bucket subscription, null = smart-ranked),
  `campaigns.pool_min_score` (float, nullable) and `campaigns.pool_cap`
  (int, default 200).
- `candidates.pool_resume_id` (nullable FK) — provenance of pool-sourced
  candidates.

## API (new)

- `POST /api/ingest/resumes` — auth: `Authorization: Bearer <api key>`.
  Multipart files (same validation: pdf/docx/txt, 10 MB) or JSON
  `{filename, text}` for clients whose DB already stores extracted text.
  Optional form/JSON fields: `external_ref`, `bucket`, `search_id`.
  Ingest side-effects: bucket-bound active searches get matching CVs
  attached + incrementally screened immediately; ranked pool searches get
  arrivals that clear their relevance bar.
  Response: `{added: n, duplicates: n, attached_to_searches: [ids]}`.
  Rate limit: 60 req/min per key; ≤20 files per request.
- `GET /api/pool/summary` (session auth) — {total, last_received_at,
  buckets: [{name, count}]} for the "Where we'll search" card and the
  bucket picker.
- `POST /api/campaigns/{id}/pool-sync` (internal + manual button) — run
  Stage-0 against the pool, attach new top matches, enqueue incremental run.
- Admin: `POST /api/admin/companies/{id}/api-keys` (issue),
  `DELETE .../api-keys/{key_id}` (revoke), list with last_used.

## UI changes

- **Start new search → "Where we'll search"**: third intake option
  **"Company CV pool"** (enabled when the pool is non-empty): bucket picker
  ("All resumes — smart-ranked" | each bucket with live count), pool size +
  last-received time, a match cap field (default 200), and copy: "We rank
  your whole pool against this role and screen only the strongest matches"
  (ranked) / "Every resume in this bucket is screened" (bucket). Both:
  "New CVs arriving later are screened automatically."
- **Search detail**: pool-backed searches show "🗄 Watching your CV pool —
  ranked X of Y pool resumes, screening top N" instead of the folder line.
- **Workspace settings**: pool section — API key management is admin-side
  (platform admin issues keys during onboarding); the client sees connection
  status, pool size, and "ping your MasterTech onboarder to connect a new
  source" (exactly the mockup's positioning).
- **Admin company page**: issue/revoke API keys, see last_used.

## Security & limits

- API keys stored hashed (sha256), shown once at issue, revocable, scoped to
  ingest only (cannot read anything).
- Per-key rate limit + payload caps; every ingest batch audit-logged
  (`ingest.resumes`: count, source key label).
- Pool respects the existing retention purge (`data_retention_days`).
- Multi-tenant isolation: pool rows and Stage-0 queries always scoped by
  company_id.

## Cost model (the 10k case, concretely)

- Ingest 10,000 CVs: parsing only — no LLM. ₹0 in tokens.
- Search created against the pool: Stage-0 SQL ranking (ms, free) →
  LLM-screen top 200 = identical cost to today's max-size upload campaign.
- Each new CV later: 1 ranking query; only relevance-bar passers cost one
  incremental screen each.

## Implementation phases (each independently shippable)

**Phase 1 — Ingest API + pool (backend core)**
1. Migrations: api_keys, pool_resumes (+tsv trigger on Postgres), campaign
   pool fields, candidate provenance FK.
2. API-key auth dependency + admin issue/revoke endpoints + tests.
3. POST /api/ingest/resumes (files + JSON-text variants, dedup, direct
   search_id attach path, audit) + tests.
4. Retention purge covers pool. Tests: multi-tenant isolation, dedup, caps.

**Phase 2 — Pool as an intake mode**
5. Stage-0 ranker: `rank_pool(company, jd_text, profile) -> [(pool_id,
   score)]` — Postgres FTS implementation + SQLite fallback + unit tests
   with a seeded 1k-row pool.
6. Campaign creation with intake_mode="pool" (no files): bucket selected →
   attach the bucket's CVs (deduped, capped); no bucket → rank + attach top
   cap. Enqueue; "Watching pool" status when nothing matches yet.
7. UI: third intake option with bucket picker + pool summary card +
   search-detail pool line.

**Phase 3 — Continuous pool watching (webhook-triggered)**
8. On ingest: bucket-tagged CV → attach to every active search bound to
   that bucket + enqueue incremental. Untagged (or ranked searches):
   single-row relevance score per active ranked search, attach where it
   clears the bar (campaign pool_min_score, default = score of current
   #cap candidate).
9. Search library shows "Watching pool" status; audit entries per
   auto-attach.

**Phase 4 — Client-side reference connector + docs**
10. `connectors/nexus_db_connector.py`: single-file script (SQL table or
    S3/folder source → webhook), config via env vars, state file for
    incremental cursor, retry/backoff. README for client IT teams.
11. Onboarding doc: issuing keys, webhook contract, connector setup.

Estimated size: Phase 1+2 ≈ one working session like today's redesign;
Phase 3 small; Phase 4 mostly documentation.

## Out of scope (explicitly)

- Managed ATS integrations (Workable/Greenhouse OAuth) — separate project,
  slots in as another producer hitting the same ingest API.
- Embedding-based semantic ranking — later drop-in for Stage-0.
- We never connect outbound to client databases.
