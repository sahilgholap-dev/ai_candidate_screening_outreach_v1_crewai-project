# Deployment Design — Vercel + Railway + Supabase (demo/staging)

Date: 2026-07-27
Status: Approved (Approach A — minimal port)

## Goal

Host NEXUS for demo/staging use: Next.js frontend on Vercel, FastAPI + CrewAI
backend on Railway, Postgres on Supabase. Existing local SQLite data
(companies, users, campaigns) is migrated to Supabase. Local dev setup keeps
working unchanged (SQLite by default).

## Architecture

```text
Browser ── Vercel (Next.js, server-side proxy /api/backend/*)
              │  BACKEND_URL
              ▼
          Railway (FastAPI + in-process queue worker thread)
              │  DATABASE_URL (session pooler)
              ▼
          Supabase Postgres
```

- All browser→backend traffic goes through the existing Next.js server-side
  proxy (`frontend/src/lib/backend.ts`), so no CORS changes are required.
- The DB-backed queue worker stays an in-process thread (single Railway
  service). No separate worker service for staging.
- Uploads remain on Railway's ephemeral disk. Acceptable: resume/JD text is
  parsed into DB rows immediately after upload, and campaign retry works from
  row text, not files.

## Components & changes

### Backend (Railway)

- Add `psycopg2-binary` dependency to `backend/pyproject.toml`.
- Service root directory: `backend`. Builder: Railway Python (uv).
- Start command:
  `alembic upgrade head && uvicorn ai_candidate_screening_outreach.app:app --host 0.0.0.0 --port $PORT`
- Env vars: `DATABASE_URL` (Supabase **session pooler**, port 5432),
  `ANTHROPIC_API_KEY`, `JWT_SECRET` (fresh random value), `FRONTEND_ORIGIN`
  (Vercel URL).
- Session pooler (not transaction pooler): SQLAlchemy's default connection
  pool and the long-lived worker thread are not pgBouncer-transaction-mode
  safe.

### Database (Supabase)

- Free-tier project, region near India (Mumbai or Singapore).
- Schema created by running `alembic upgrade head` from the local machine
  first — validates all migrations on Postgres before Railway boots.
- Data migration: one-off script `backend/scripts/migrate_sqlite_to_pg.py`
  copies every table from `campaigns.db` in FK order (companies → users →
  campaigns → candidates → audit/usage tables), preserving primary keys, then
  resets Postgres sequences. Verified by comparing per-table row counts.

### Frontend (Vercel)

- Project root directory: `frontend`, Next.js preset, no code changes.
- Single env var: `BACKEND_URL` = Railway public URL.

## Order of operations

1. Link local repo to GitHub remote; push latest commits.
2. Add `psycopg2-binary`; commit.
3. Create Supabase project (user, interactive); collect pooler URL.
4. Run Alembic migrations against Supabase locally.
5. Run data migration script; verify row counts.
6. Create Railway service from GitHub repo; set env vars; deploy; verify
   `/api/auth/login` works against Supabase.
7. Create Vercel project from GitHub repo; set `BACKEND_URL`; deploy.
8. End-to-end verification (below).

## Rollback / safety

- Local SQLite (`campaigns.db`) is never modified or deleted; local dev
  remains the fallback.
- A fresh `JWT_SECRET` on Railway means hosted sessions are independent of
  local ones (intended).
- Migration script is idempotent-safe by running against an empty schema only
  (aborts if target tables contain rows).

## Verification

- Log in on the Vercel URL as platform admin; confirm migrated companies,
  users, and campaign history are visible.
- Run one small campaign (1–2 resumes) end-to-end to prove the queue worker
  and Anthropic key work on Railway.
- Confirm audit log entries are written for the test actions.

## Out of scope (deferred to production hardening)

- Railway volume for uploads; separate queue-worker service
  (`FOR UPDATE SKIP LOCKED`); Supabase backups/PITR; custom domain; paid
  tiers; email sending.
