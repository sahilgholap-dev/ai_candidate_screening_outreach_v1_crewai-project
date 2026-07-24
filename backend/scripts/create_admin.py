"""Bootstrap or reset a platform admin.

Usage:
    uv run python scripts/create_admin.py --email admin@example.com [--name "Full Name"]

Prints a generated temporary password; the admin must change it on first login.
If the user already exists, resets their password and re-activates them.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ai_candidate_screening_outreach.auth.security import (  # noqa: E402
    generate_temp_password,
    hash_password,
)
from ai_candidate_screening_outreach.db.database import Base, SessionLocal, engine  # noqa: E402
from ai_candidate_screening_outreach.db.models import User  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or reset a platform admin user")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default=None)
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)

    email = args.email.strip().lower()
    temp_password = generate_temp_password()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.password_hash = hash_password(temp_password)
            user.role = "platform_admin"
            user.must_reset_password = True
            user.is_active = True
            action = "reset"
        else:
            user = User(
                email=email,
                full_name=args.name,
                password_hash=hash_password(temp_password),
                role="platform_admin",
                company_id=None,
                must_reset_password=True,
                is_active=True,
            )
            db.add(user)
            action = "created"
        db.commit()
    finally:
        db.close()

    print(f"Platform admin {action}: {email}")
    print(f"Temporary password: {temp_password}")
    print("They will be required to change it on first login.")


if __name__ == "__main__":
    main()
