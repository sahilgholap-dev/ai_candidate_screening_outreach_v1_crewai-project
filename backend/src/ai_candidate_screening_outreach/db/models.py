import json
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from pydantic import BaseModel, Field
from typing import List, Optional
from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


# --- Pydantic Schemas for CrewAI Output ---
class CandidateEvaluation(BaseModel):
    candidate_id: int = Field(description="The numeric Candidate ID provided at the top of the resume text")
    name: str = Field(description="The full name of the candidate")
    score: int = Field(description="The overall evaluation score out of 100")
    recommendation: str = Field(description="One of: 'Shortlist', 'Maybe', or 'Reject'")
    hard_filter_failed: bool = Field(description="True if the candidate failed a hard filter")
    key_strengths: List[str] = Field(description="List of key strengths from the resume")
    key_gaps: List[str] = Field(description="List of key gaps or missing requirements")
    rationale: str = Field(description="A concise rationale for the scoring and recommendation")
    email_draft: Optional[str] = Field(None, description="The drafted outreach email if shortlisted")
    sms_draft: Optional[str] = Field(None, description="The drafted outreach SMS if shortlisted")

class CampaignResults(BaseModel):
    evaluations: List[CandidateEvaluation]


# --- SQLAlchemy ORM Models ---
class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    pitch = Column(Text, nullable=True)  # short "about us" used in outreach drafts
    office_locations = Column(JSON, nullable=True)  # list[str]
    default_region = Column(String, default="IN")  # US | UK | IN
    recruiter_signature = Column(Text, nullable=True)
    tone_notes = Column(Text, nullable=True)
    default_threshold = Column(Float, default=65.0)
    # Admin-controlled: whether this company may set gender eligibility on
    # campaigns (lawful for certain roles in India; narrow BFOQ/GOR elsewhere).
    allow_gender_eligibility = Column(Boolean, default=False, nullable=False)
    data_retention_days = Column(Integer, nullable=True)  # candidate data purge horizon
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    users = relationship("User", back_populates="company")
    campaigns = relationship("Campaign", back_populates="company")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    role = Column(String, nullable=False, default="company_user")  # platform_admin | company_user
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)  # null for platform admins
    must_reset_password = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    company = relationship("Company", back_populates="users")


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String, index=True)
    region = Column(String, nullable=True)  # US | UK | IN (defaults from company)
    threshold = Column(Float, default=65.0)
    jd_text = Column(Text)
    requirements = Column(JSON, nullable=True)  # RequirementsProfile (Phase 3)
    status = Column(String, default="Pending")  # Pending, Queued, Processing, Completed, Error
    token_usage = Column(JSON, nullable=True)  # aggregated LLM usage for this run
    final_report = Column(Text, nullable=True)  # Kept for legacy or high-level summary
    created_at = Column(DateTime(timezone=True), default=utcnow)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    company = relationship("Company", back_populates="campaigns")
    candidates = relationship(
        "Candidate", back_populates="campaign", cascade="all, delete-orphan"
    )


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    original_filename = Column(String)
    parsed_text = Column(Text)

    # Structured evaluation fields
    name = Column(String, nullable=True)
    score = Column(Integer, nullable=True)
    recommendation = Column(String, nullable=True)
    hard_filter_failed = Column(Boolean, default=False)
    key_strengths = Column(Text, nullable=True)  # Stored as JSON string
    key_gaps = Column(Text, nullable=True)  # Stored as JSON string
    rationale = Column(Text, nullable=True)
    email_draft = Column(Text, nullable=True)
    sms_draft = Column(Text, nullable=True)

    campaign = relationship("Campaign", back_populates="candidates")

    def set_strengths(self, strengths_list: List[str]):
        self.key_strengths = json.dumps(strengths_list)

    def get_strengths(self) -> List[str]:
        if self.key_strengths:
            return json.loads(self.key_strengths)
        return []

    def set_gaps(self, gaps_list: List[str]):
        self.key_gaps = json.dumps(gaps_list)

    def get_gaps(self) -> List[str]:
        if self.key_gaps:
            return json.loads(self.key_gaps)
        return []
