"""Audit trail helper. Call inside the request's DB session; committed with it."""

from .db.models import AuditLog, User


def log_action(
    db,
    action: str,
    user: User | None = None,
    company_id: int | None = None,
    detail: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            user_email=user.email if user else None,
            company_id=company_id
            if company_id is not None
            else (user.company_id if user else None),
            action=action,
            detail=detail or {},
        )
    )
