from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.deps import require_admin
from ..auth.security import generate_temp_password, hash_password
from ..db.database import get_db
from ..db.models import Campaign, Company, User

router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)

REGIONS = {"US", "UK", "IN"}


# ---------- Schemas ----------

class CompanyBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    pitch: str | None = None
    office_locations: list[str] = []
    default_region: str = "IN"
    recruiter_signature: str | None = None
    tone_notes: str | None = None
    default_threshold: float = Field(default=65.0, ge=0, le=100)
    allow_gender_eligibility: bool = False
    data_retention_days: int | None = Field(default=None, ge=1)

    @field_validator("default_region")
    @classmethod
    def _valid_region(cls, v: str) -> str:
        v = v.upper()
        if v not in REGIONS:
            raise ValueError(f"default_region must be one of {sorted(REGIONS)}")
        return v


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    pitch: str | None = None
    office_locations: list[str] | None = None
    default_region: str | None = None
    recruiter_signature: str | None = None
    tone_notes: str | None = None
    default_threshold: float | None = Field(default=None, ge=0, le=100)
    allow_gender_eligibility: bool | None = None
    data_retention_days: int | None = Field(default=None, ge=1)
    is_active: bool | None = None

    @field_validator("default_region")
    @classmethod
    def _valid_region(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.upper()
        if v not in REGIONS:
            raise ValueError(f"default_region must be one of {sorted(REGIONS)}")
        return v


class CompanyOut(CompanyBase):
    id: int
    is_active: bool
    created_at: datetime | None
    user_count: int = 0
    campaign_count: int = 0

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str | None
    role: str
    is_active: bool
    must_reset_password: bool
    created_at: datetime | None

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    full_name: str | None = None

    @field_validator("email")
    @classmethod
    def _basic_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        return v


class UserCreated(UserOut):
    temp_password: str


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None


# ---------- Helpers ----------

def _get_company(db: Session, company_id: int) -> Company:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def _company_out(db: Session, company: Company) -> CompanyOut:
    out = CompanyOut.model_validate(company)
    out.user_count = (
        db.query(func.count(User.id)).filter(User.company_id == company.id).scalar() or 0
    )
    out.campaign_count = (
        db.query(func.count(Campaign.id))
        .filter(Campaign.company_id == company.id)
        .scalar()
        or 0
    )
    return out


# ---------- Companies ----------

@router.get("/companies", response_model=list[CompanyOut])
def list_companies(db: Session = Depends(get_db)):
    companies = db.query(Company).order_by(Company.id.desc()).all()
    return [_company_out(db, c) for c in companies]


@router.post("/companies", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def create_company(body: CompanyCreate, db: Session = Depends(get_db)):
    company = Company(**body.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return _company_out(db, company)


@router.get("/companies/{company_id}", response_model=CompanyOut)
def get_company(company_id: int, db: Session = Depends(get_db)):
    return _company_out(db, _get_company(db, company_id))


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def update_company(company_id: int, body: CompanyUpdate, db: Session = Depends(get_db)):
    company = _get_company(db, company_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(company, key, value)
    db.commit()
    db.refresh(company)
    return _company_out(db, company)


# ---------- Company users ----------

@router.get("/companies/{company_id}/users", response_model=list[UserOut])
def list_company_users(company_id: int, db: Session = Depends(get_db)):
    _get_company(db, company_id)
    return (
        db.query(User)
        .filter(User.company_id == company_id)
        .order_by(User.id.desc())
        .all()
    )


@router.post(
    "/companies/{company_id}/users",
    response_model=UserCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_company_user(company_id: int, body: UserCreate, db: Session = Depends(get_db)):
    company = _get_company(db, company_id)
    if not company.is_active:
        raise HTTPException(status_code=400, detail="Company is deactivated")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    temp_password = generate_temp_password()
    user = User(
        email=body.email,
        full_name=body.full_name,
        password_hash=hash_password(temp_password),
        role="company_user",
        company_id=company_id,
        must_reset_password=True,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserCreated(
        **UserOut.model_validate(user).model_dump(), temp_password=temp_password
    )


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "platform_admin":
        raise HTTPException(status_code=403, detail="Admins cannot be managed via this endpoint")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/reset-password", response_model=UserCreated)
def admin_reset_user_password(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "platform_admin":
        raise HTTPException(status_code=403, detail="Admins cannot be managed via this endpoint")

    temp_password = generate_temp_password()
    user.password_hash = hash_password(temp_password)
    user.must_reset_password = True
    db.commit()
    db.refresh(user)

    return UserCreated(
        **UserOut.model_validate(user).model_dump(), temp_password=temp_password
    )
