# AI Candidate Screening & Outreach — Multi-Tenant Platform

Multi-tenant recruitment screening platform. Platform admins onboard companies
(with a full company profile); company users upload a JD + resumes per campaign,
answer a structured requirements form, and run an AI screening pipeline
(CrewAI + Claude) that scores candidates, applies recruiter-defined hard
filters, and drafts human-reviewed outreach messages.

Target markets: US, UK, India.

## Repository layout

```text
backend/    FastAPI + SQLAlchemy + Alembic + CrewAI pipeline (Python, uv)
frontend/   Next.js (App Router) + Tailwind CSS + shadcn/ui (TypeScript)
```

## Backend

```bash
cd backend
uv sync                                  # install deps into .venv
# .env must contain ANTHROPIC_API_KEY
uv run alembic upgrade head              # apply DB migrations (SQLite: campaigns.db)
uv run uvicorn ai_candidate_screening_outreach.app:app --reload --port 8000
```

- Database: SQLite for now (`backend/campaigns.db`, WAL mode). Set `DATABASE_URL`
  to a Postgres URL to switch — no code changes required.
- Migrations: Alembic (`backend/alembic/`), configured with `render_as_batch`
  for SQLite compatibility.

## Frontend

```bash
cd frontend
npm install
npm run dev                              # http://localhost:3000
```

Stack: Next.js App Router, TypeScript, Tailwind v4, shadcn/ui,
TanStack Query, react-hook-form + zod.

## Staging deployment

| Piece | Where | Notes |
| --- | --- | --- |
| Frontend | Vercel — <https://ai-candidate-screening-outreach-v1.vercel.app> | root dir `frontend`, env: `BACKEND_URL` |
| Backend | Railway (Dockerfile build) | root dir `backend`, env: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `FRONTEND_ORIGIN` |
| Database | Supabase Postgres (`ap-northeast-2`) | connect via **session pooler** (port 5432); password must be URL-encoded in `DATABASE_URL` |

Deploys are automatic on push to `main`. The Railway container runs
`alembic upgrade head` before serving (see `backend/Dockerfile`). Uploads on
Railway are ephemeral — resume/JD text is parsed into DB rows, so this is
acceptable for staging. One-off data migration from local SQLite:
`backend/scripts/migrate_sqlite_to_pg.py`. Design/plan docs:
`docs/superpowers/`.

## Secrets & data hygiene

- `.env`, `*.db`, `logs/`, `uploads/`, `outputs/`, `downloads/` are gitignored.
  Never commit API keys or scraper session cookies.
- Outreach messages are drafts only and require human review — the system never
  sends anything automatically.

## Implementation phases

| Phase | Scope |
| --- | --- |
| 0 | Foundation: git, Alembic, WAL, Next.js scaffold (done) |
| 1 | Tenancy & auth: companies/users tables, JWT, login flow (done) |
| 2 | Admin onboarding: company + user management (API + UI) (done) |
| 3 | Requirements Profile: structured campaign creation form (done) |
| 4 | Pipeline rework: dynamic hard filters/weights, job queue, per-run isolation (done) |
| 5 | Results & outreach review UI (done) |
| 6 | Hardening & compliance: retention, audit log, region rules (done) |
