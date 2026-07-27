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
