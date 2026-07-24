"""DB-backed campaign queue.

Campaigns are created with status "Queued" (plus queue metadata stored on the
row itself). A single daemon worker thread claims them oldest-first and runs
the pipeline serially — safe on SQLite (single writer) and it survives
restarts: anything still "Queued" is picked up on the next boot, and anything
stuck in "Processing" (crash mid-run) is re-queued at startup.

With Postgres later, multiple workers can claim with FOR UPDATE SKIP LOCKED —
the statuses stay the same.
"""

import os
import threading
import time
import traceback

from ..db.database import SessionLocal
from ..db.models import Campaign, utcnow
from .retention import purge_expired_data
from .runner import run_campaign

POLL_SECONDS = 3
RETENTION_INTERVAL_SECONDS = 24 * 3600
_started = threading.Event()


def requeue_stuck_campaigns() -> int:
    """Campaigns left 'Processing' by a crashed/killed process -> 'Queued'."""
    db = SessionLocal()
    try:
        stuck = db.query(Campaign).filter(Campaign.status == "Processing").all()
        for campaign in stuck:
            campaign.status = "Queued"
        db.commit()
        return len(stuck)
    finally:
        db.close()


def _claim_next() -> int | None:
    """Claim the oldest queued campaign; returns its id."""
    db = SessionLocal()
    try:
        campaign = (
            db.query(Campaign)
            .filter(Campaign.status == "Queued")
            .order_by(Campaign.id.asc())
            .first()
        )
        if not campaign:
            return None
        campaign.status = "Processing"
        campaign.started_at = utcnow()
        db.commit()
        return campaign.id
    finally:
        db.close()


def _worker_loop() -> None:
    print("[queue] campaign worker started", flush=True)
    last_retention_run = 0.0
    while True:
        try:
            if time.monotonic() - last_retention_run > RETENTION_INTERVAL_SECONDS or last_retention_run == 0.0:
                last_retention_run = time.monotonic()
                purge_expired_data()
            campaign_id = _claim_next()
            if campaign_id is None:
                time.sleep(POLL_SECONDS)
                continue
            print(f"[queue] processing campaign {campaign_id}", flush=True)
            run_campaign(campaign_id)
            print(f"[queue] finished campaign {campaign_id}", flush=True)
        except Exception:
            traceback.print_exc()
            time.sleep(POLL_SECONDS)


def start_worker() -> None:
    """Idempotent: starts the single daemon worker thread once per process."""
    if _started.is_set():
        return
    _started.set()
    if os.getenv("DISABLE_QUEUE_WORKER") == "1":
        print("[queue] worker disabled via DISABLE_QUEUE_WORKER=1")
        return
    threading.Thread(target=_worker_loop, name="campaign-queue-worker", daemon=True).start()


def enqueue_campaign(db, campaign: Campaign) -> None:
    campaign.status = "Queued"
    db.commit()
