import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import User
from .security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or deactivated"
        )
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "platform_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_company_user(user: User = Depends(get_current_user)) -> User:
    """Company users and platform admins. Company users must belong to a company."""
    if user.role == "platform_admin":
        return user
    if user.company_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User is not linked to a company"
        )
    if user.company and not user.company.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Company account is deactivated"
        )
    return user
