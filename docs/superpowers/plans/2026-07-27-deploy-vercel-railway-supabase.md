# Deploy to Vercel + Railway + Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host NEXUS staging: Next.js frontend on Vercel, FastAPI backend on Railway, Postgres on Supabase, with existing SQLite data migrated.

**Architecture:** Browser → Vercel (Next.js server-side proxy, `BACKEND_URL`) → Railway (FastAPI + in-process queue worker) → Supabase Postgres (session pooler). No CORS changes; uploads on ephemeral disk; migrations run on every Railway deploy.

**Tech Stack:** Next.js (Vercel), FastAPI + uvicorn + SQLAlchemy + Alembic (Railway, uv/Python 3.13), Supabase Postgres via `psycopg2-binary`.

## Global Constraints

- Local SQLite (`backend/campaigns.db`) is never modified or deleted.
- Supabase connection string must be the **session pooler** (port 5432), not the transaction pooler (6543).
- Backend Python: `>=3.10,<3.14` (Railway must use 3.13).
- Migration script must abort if any target table already contains rows.
- Repo remote: `https://github.com/sahilgholap-dev/ai_candidate_screening_outreach_v1_crewai-project`, branch `main`.
- All shell commands below run from the repo root unless stated; backend commands use `backend/.venv/Scripts/python.exe` locally.

Tables (FK order handled automatically via `Base.metadata.sorted_tables`): `companies`, `users`, `campaigns`, `audit_log`, `candidates`.

---

### Task 1: Link GitHub remote and sync

**Files:** none (git config only)

**Interfaces:**
- Produces: `origin` remote pointing at the GitHub repo, local `main` pushed.

- [ ] **Step 1: Add remote**

```bash
git remote add origin https://github.com/sahilgholap-dev/ai_candidate_screening_outreach_v1_crewai-project.git
git fetch origin
```

- [ ] **Step 2: Compare histories before pushing**

```bash
git log --oneline origin/main -3
git log --oneline main -3
```

Expected: `origin/main` is an ancestor of local `main` (user pushed 3 days ago; local has newer commits e.g. the design doc). If histories have diverged (remote has commits local lacks), STOP and show the user both logs — do not force-push.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: success, remote fast-forwards.

### Task 2: Add Postgres driver

**Files:**
- Modify: `backend/pyproject.toml` (dependencies list)

**Interfaces:**
- Produces: `psycopg2-binary` importable from the backend venv; `uv.lock` updated.

- [ ] **Step 1: Add dependency**

```bash
cd backend && uv add psycopg2-binary
```

- [ ] **Step 2: Verify it imports**

```bash
backend/.venv/Scripts/python.exe -c "import psycopg2; print(psycopg2.__version__)"
```

Expected: prints a version like `2.9.x`.

- [ ] **Step 3: Commit and push**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "Add psycopg2-binary for Postgres (Supabase) support"
git push origin main
```

### Task 3: SQLite → Postgres migration script

**Files:**
- Create: `backend/scripts/migrate_sqlite_to_pg.py`

**Interfaces:**
- Consumes: `Base` metadata from `ai_candidate_screening_outreach.db.database`.
- Produces: CLI `python scripts/migrate_sqlite_to_pg.py --target <pg-url>` that copies all rows preserving PKs, resets sequences, prints per-table `sqlite=N pg=N` counts, exits non-zero on mismatch or non-empty target.

- [ ] **Step 1: Write the script**

```python
"""One-off copy of the local SQLite database into Postgres (Supabase).

Usage:
    uv run python scripts/migrate_sqlite_to_pg.py --target "postgresql://..."

Safety: aborts if any target table already has rows. Never writes to SQLite.
Run `alembic upgrade head` against the target FIRST so the schema exists.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from sqlalchemy import create_engine, func, select, text  # noqa: E402

# Importing database.py builds Base metadata; models must be imported so all
# tables register.
from ai_candidate_screening_outreach.db.database import Base  # noqa: E402
from ai_candidate_screening_outreach.db import models  # noqa: E402,F401


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True, help="Postgres URL")
    parser.add_argument("--source", default="sqlite:///./campaigns.db")
    args = parser.parse_args()

    src = create_engine(args.source)
    dst = create_engine(args.target)

    tables = Base.metadata.sorted_tables  # FK-dependency order

    with dst.connect() as d:
        for table in tables:
            count = d.execute(select(func.count()).select_from(table)).scalar()
            if count:
                sys.exit(f"ABORT: target table '{table.name}' has {count} rows")

    failures = []
    with src.connect() as s, dst.begin() as d:
        for table in tables:
            rows = [dict(r) for r in s.execute(select(table)).mappings()]
            if rows:
                d.execute(table.insert(), rows)
            src_n = len(rows)
            dst_n = d.execute(select(func.count()).select_from(table)).scalar()
            status = "OK" if src_n == dst_n else "MISMATCH"
            print(f"{table.name}: sqlite={src_n} pg={dst_n} {status}")
            if src_n != dst_n:
                failures.append(table.name)

            pk_cols = [c for c in table.primary_key.columns]
            is_pg = dst.dialect.name == "postgresql"
            if is_pg and len(pk_cols) == 1 and pk_cols[0].autoincrement and src_n:
                pk = pk_cols[0].name
                d.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', '{pk}'), "
                        f"(SELECT MAX({pk}) FROM {table.name}))"
                    )
                )

    if failures:
        sys.exit(f"FAILED tables: {failures}")
    print("Migration complete.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Dry-run test against a scratch SQLite target** (proves copy logic without needing Postgres; sequence-reset lines only run on Postgres URLs, so wrap: skip setval when `dst.dialect.name != "postgresql"` — include this guard in the script: `if ... and dst.dialect.name == "postgresql":`)

```bash
cd backend && .venv/Scripts/python.exe -c "
import subprocess, sqlite3, os
# build empty schema in scratch db by copying schema only
src = sqlite3.connect('campaigns.db'); dst = sqlite3.connect('scratch_test.db')
for (ddl,) in src.execute(\"SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL\"):
    dst.execute(ddl)
dst.commit(); src.close(); dst.close()
r = subprocess.run(['.venv/Scripts/python.exe','scripts/migrate_sqlite_to_pg.py','--target','sqlite:///./scratch_test.db'])
os.remove('scratch_test.db')
exit(r.returncode)
"
```

Expected: per-table `sqlite=N pg=N OK` lines, `Migration complete.`, exit 0.

- [ ] **Step 3: Re-run abort check** — running Step 2 twice without deleting scratch would abort; the test deletes scratch, so instead verify abort logic by running the script against the *source itself* as target:

```bash
cd backend && .venv/Scripts/python.exe scripts/migrate_sqlite_to_pg.py --target "sqlite:///./campaigns.db"
```

Expected: `ABORT: target table 'companies' has N rows`, non-zero exit.

- [ ] **Step 4: Commit and push**

```bash
git add backend/scripts/migrate_sqlite_to_pg.py
git commit -m "Add one-off SQLite -> Postgres migration script"
git push origin main
```

### Task 4: Supabase project (USER-INTERACTIVE GATE)

**Files:** none

**Interfaces:**
- Produces: `DATABASE_URL` (session pooler, port 5432) available for Tasks 5–7.

- [ ] **Step 1: Ask the user to do the following in the Supabase dashboard** (agent cannot authenticate):
  1. https://supabase.com/dashboard → New project. Region: Mumbai (`ap-south-1`) or Singapore. Save the database password somewhere safe.
  2. Project → Connect (top bar) → "Session pooler" tab → copy the URI (looks like `postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`).
  3. Paste the URI into the chat (or put it in `backend/.env` as `SUPABASE_DATABASE_URL=` and say done).

- [ ] **Step 2: Validate the URL** — confirm port 5432 and `pooler.supabase.com` host. If port is 6543 (transaction pooler), ask for the session pooler string instead.

### Task 5: Run migrations against Supabase

**Files:** none

**Interfaces:**
- Consumes: `DATABASE_URL` from Task 4.
- Produces: full schema (5 tables + `alembic_version`) on Supabase.

- [ ] **Step 1: Upgrade**

```powershell
cd backend
$env:DATABASE_URL = "<supabase-session-pooler-url>"
uv run alembic upgrade head
```

Expected: all migrations apply cleanly, ending at head revision (`5beb0b4b14cb` or later).

- [ ] **Step 2: Verify tables exist**

```powershell
uv run python -c "
import os
from sqlalchemy import create_engine, inspect
insp = inspect(create_engine(os.environ['DATABASE_URL']))
print(sorted(insp.get_table_names()))
"
```

Expected: `['alembic_version', 'audit_log', 'campaigns', 'candidates', 'companies', 'users']`.

### Task 6: Migrate data

**Files:** none

**Interfaces:**
- Consumes: script from Task 3, URL from Task 4, schema from Task 5.
- Produces: Supabase populated with all local rows, sequences reset.

- [ ] **Step 1: Run**

```powershell
cd backend
uv run python scripts/migrate_sqlite_to_pg.py --target $env:DATABASE_URL
```

Expected: `sqlite=N pg=N OK` for all 5 tables, `Migration complete.`

- [ ] **Step 2: Spot-check login-critical data**

```powershell
uv run python -c "
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ['DATABASE_URL'])
with e.connect() as c:
    for r in c.execute(text('SELECT id, email, role, is_active FROM users ORDER BY id')): print(r)
"
```

Expected: both users present with correct roles.

- [ ] **Step 3: Local smoke test of app against Supabase** (same shell, DATABASE_URL still set)

```powershell
uv run uvicorn ai_candidate_screening_outreach.app:app --port 8001
# separate check:
# POST http://localhost:8001/api/auth/login with admin credentials -> 200 + token
```

Expected: app boots (worker thread starts, no SQLite pragmas), login returns a token. Stop the server after.

### Task 7: Railway backend (USER-INTERACTIVE GATE)

**Files:**
- Create: `backend/railway.json`

**Interfaces:**
- Consumes: GitHub repo (Task 1–3 pushed), Supabase URL.
- Produces: public Railway URL for Task 8.

- [ ] **Step 1: Add Railway config** (committed so the service is reproducible)

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "alembic upgrade head && uvicorn ai_candidate_screening_outreach.app:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Commit:

```bash
git add backend/railway.json
git commit -m "Railway deploy config: migrate then serve"
git push origin main
```

- [ ] **Step 2: Generate JWT secret for the user**

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

- [ ] **Step 3: Ask the user to do the following in Railway dashboard:**
  1. New Project → Deploy from GitHub repo → select the repo.
  2. Service Settings → Root Directory: `backend`.
  3. Variables: `DATABASE_URL` (Supabase session pooler URL), `ANTHROPIC_API_KEY` (from `backend/.env`), `JWT_SECRET` (value from Step 2), `FRONTEND_ORIGIN` (placeholder `https://example.vercel.app` for now — updated in Task 8).
  4. Settings → Networking → Generate Domain. Paste the resulting `https://*.up.railway.app` URL into chat.

- [ ] **Step 4: Verify deployment**

```powershell
Invoke-WebRequest -Method POST -Uri "https://<railway-url>/api/auth/login" -ContentType "application/json" -Body '{"email":"sahil.gholap@mastertech.co.in","password":"<current password>"}'
```

Expected: 200 with token JSON (or 401 if password typo — either proves app+DB work; a 500/timeout means investigate Railway logs).

### Task 8: Vercel frontend (USER-INTERACTIVE GATE)

**Files:** none

**Interfaces:**
- Consumes: Railway URL from Task 7.
- Produces: public Vercel URL.

- [ ] **Step 1: Ask the user to do the following in Vercel dashboard:**
  1. New Project → Import the GitHub repo.
  2. Root Directory: `frontend` (framework auto-detects Next.js).
  3. Environment variable: `BACKEND_URL` = `https://<railway-url>` (no trailing slash).
  4. Deploy; paste the production URL into chat.

- [ ] **Step 2: Update Railway `FRONTEND_ORIGIN`** — ask user to set it to the real Vercel URL (service redeploys automatically).

### Task 9: End-to-end verification

**Files:** none

- [ ] **Step 1: User logs in** on the Vercel URL as platform admin; confirms companies, users, and campaign history are visible (migrated data).
- [ ] **Step 2: Run one small campaign** (1–2 resumes) from the recruiter account; confirm it progresses Queued → Processing → Complete and results render.
- [ ] **Step 3: Confirm audit log** shows the test actions (admin → audit view).
- [ ] **Step 4: Commit any remaining doc updates** (e.g. README deployment section):

```bash
git add README.md
git commit -m "Document staging deployment (Vercel + Railway + Supabase)"
git push origin main
```
