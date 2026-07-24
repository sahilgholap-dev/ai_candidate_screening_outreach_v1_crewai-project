"""Data-retention purge (GDPR / client policy).

For every company with data_retention_days set, campaigns finished more than
that many days ago get their candidate PII removed:
  - candidate rows deleted (resume text, contact data, drafts)
  - campaign.final_report cleared (contains candidate details)
  - archived output files for the campaign deleted from disk
Campaign metadata (name, status, token usage) is kept for billing history,
with purged_at stamped. Runs daily from the queue worker; every purge is
audit-logged as a system action.
"""

import os
import shutil
from datetime import timedelta

from ..audit import log_action
from ..db.database import SessionLocal
from ..db.models import Campaign, Candidate, Company, utcnow


def purge_expired_data() -> int:
    """Returns the number of campaigns purged."""
    db = SessionLocal()
    purged = 0
    try:
        companies = (
            db.query(Company).filter(Company.data_retention_days.isnot(None)).all()
        )
        now = utcnow()
        for company in companies:
            cutoff = now - timedelta(days=company.data_retention_days)
            campaigns = (
                db.query(Campaign)
                .filter(
                    Campaign.company_id == company.id,
                    Campaign.purged_at.is_(None),
                    Campaign.finished_at.isnot(None),
                    Campaign.finished_at < cutoff,
                )
                .all()
            )
            for campaign in campaigns:
                deleted = (
                    db.query(Candidate)
                    .filter(Candidate.campaign_id == campaign.id)
                    .delete(synchronize_session=False)
                )
                campaign.final_report = None
                campaign.purged_at = now
                shutil.rmtree(
                    os.path.join("outputs", f"campaign_{campaign.id}"),
                    ignore_errors=True,
                )
                log_action(
                    db,
                    "retention.purge",
                    company_id=company.id,
                    detail={
                        "campaign_id": campaign.id,
                        "candidates_deleted": deleted,
                        "retention_days": company.data_retention_days,
                    },
                )
                purged += 1
        db.commit()
        if purged:
            print(f"[retention] purged {purged} campaign(s)", flush=True)
        return purged
    finally:
        db.close()
