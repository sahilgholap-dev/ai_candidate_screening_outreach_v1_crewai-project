from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import User
from .deps import get_current_user
from .security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_reset_password: bool
    role: str
    full_name: str | None
    company_id: int | None


class ResetPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class MeResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    role: str
    company_id: int | None
    must_reset_password: bool


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        # Same error for unknown email and wrong password — don't leak which
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    return LoginResponse(
        access_token=create_access_token(user.id),
        must_reset_password=user.must_reset_password,
        role=user.role,
        full_name=user.full_name,
        company_id=user.company_id,
    )


@router.post("/reset-password")
def reset_password(
    body: ResetPasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from the current one",
        )
    user.password_hash = hash_password(body.new_password)
    user.must_reset_password = False
    db.commit()
    return {"success": True}


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)):
    return MeResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        company_id=user.company_id,
        must_reset_password=user.must_reset_password,
    )
