"""API test harness: isolated temp SQLite DB, queue worker disabled.

Env vars MUST be set before any app import — database.py reads DATABASE_URL
at import time.
"""

import os
import sys
import tempfile

_TMPDIR = tempfile.mkdtemp(prefix="screening-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMPDIR}/test.db"
os.environ["DISABLE_QUEUE_WORKER"] = "1"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ai_candidate_screening_outreach.app import app  # noqa: E402
from ai_candidate_screening_outreach.auth.security import hash_password  # noqa: E402
from ai_candidate_screening_outreach.db.database import SessionLocal  # noqa: E402
from ai_candidate_screening_outreach.db.models import Company, User  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def company_auth(client):
    db = SessionLocal()
    try:
        company = Company(name="TestCo", default_region="IN")
        db.add(company)
        db.flush()
        user = User(
            email="user@testco.example",
            password_hash=hash_password("pw123456"),
            role="company_user",
            company_id=company.id,
            must_reset_password=False,
            is_active=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()
    res = client.post(
        "/api/auth/login",
        json={"email": "user@testco.example", "password": "pw123456"},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def create_campaign_fn(client, company_auth):
    def _create(intake_mode="upload", resumes=(("r1.txt", b"resume one"),), folder_name=None):
        files = [("jd_file", ("jd.txt", b"a job description", "text/plain"))]
        for fname, fbytes in resumes:
            files.append(("resume_files", (fname, fbytes, "text/plain")))
        data = {
            "campaign_name": "T",
            "threshold": "65",
            "region": "IN",
            "intake_mode": intake_mode,
        }
        if folder_name:
            data["folder_name"] = folder_name
        res = client.post(
            "/api/campaigns", data=data, files=files, headers=company_auth
        )
        return res

    return _create
