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
class SkillJudgment(BaseModel):
    """Binary fact-check: is this skill evidenced on the resume? The LLM only
    answers yes/no per item; all point arithmetic happens in code."""

    skill: str = Field(description="The skill exactly as listed in the Unified Requirements Profile")
    present: bool = Field(description="True if the skill (or a clear equivalent) appears on the resume")


class MustHaveJudgment(BaseModel):
    item: str = Field(description="The must-have exactly as listed in the Unified Requirements Profile")
    status: str = Field(
        description="'met' if the resume evidences it, 'unmet' if the resume explicitly contradicts it, 'unknown' if the resume is silent"
    )


class CandidateEvaluation(BaseModel):
    candidate_id: int = Field(description="The numeric Candidate ID provided at the top of the resume text")
    name: str = Field(description="The full name of the candidate")
    score: int = Field(default=0, description="Leave 0 — the system computes the score from the judgments")
    recommendation: str = Field(default="", description="Leave empty — the system computes the recommendation")
    hard_filter_failed: bool = Field(description="True if the candidate failed a hard filter")
    required_skill_judgments: List[SkillJudgment] = Field(
        default_factory=list,
        description="One judgment per Required Skill in the Unified Requirements Profile, in order",
    )
    preferred_skill_judgments: List[SkillJudgment] = Field(
        default_factory=list,
        description="One judgment per Preferred / Nice-to-Have skill, in order",
    )
    must_have_judgments: List[MustHaveJudgment] = Field(
        default_factory=list,
        description="One judgment per Must-Have item, in order",
    )
    estimated_total_years: Optional[float] = Field(
        None,
        description="Total career years from work-history dates; null if the resume gives no duration evidence",
    )
    education_status: str = Field(
        default="unknown",
        description="'met' if the education requirement is satisfied (or equivalent experience where allowed), 'unmet' if clearly not, 'unknown' if the resume is silent or no requirement exists",
    )
    key_strengths: List[str] = Field(description="List of key strengths from the resume")
    key_gaps: List[str] = Field(description="List of key gaps or missing requirements")
    rationale: str = Field(description="A concise rationale for the scoring and recommendation")
    needs_info: List[str] = Field(
        default_factory=list,
        description="Hard filters that could not be verified from the resume (candidate needs human review)",
    )
    flags: List[str] = Field(
        default_factory=list,
        description="Non-rejecting review flags, e.g. 'over_budget', 'overqualified', 'employment_gap'",
    )
    email_draft: Optional[str] = Field(None, description="The drafted outreach email if shortlisted")
    sms_draft: Optional[str] = Field(None, description="The drafted outreach SMS if shortlisted")

class CampaignResults(BaseModel):
    evaluations: List[CandidateEvaluation]


class OutreachDraft(BaseModel):
    candidate_id: int = Field(description="The numeric Candidate ID of the shortlisted candidate")
    email_draft: str = Field(description="The drafted outreach email")
    sms_draft: str = Field(description="The drafted outreach SMS (under 160 chars)")


class OutreachResults(BaseModel):
    drafts: List[OutreachDraft]


class UnifiedRequirements(BaseModel):
    """Structured Stage 1 output. Constraining the profile to this schema (and
    rendering it deterministically) keeps the scoring rubric's inputs stable
    across runs — free-form prose drifted run-to-run and swung scores."""

    summary: str = Field(description="2-3 plain-language sentences describing the role")
    required_skills: List[str] = Field(
        default_factory=list, description="Non-negotiable technical and soft skills"
    )
    preferred_skills: List[str] = Field(
        default_factory=list, description="Bonus / nice-to-have skills"
    )
    min_years_experience: str = Field(
        default="Not specified",
        description="Numeric minimum ONLY if stated verbatim in a source, else 'Not specified'",
    )
    location: str = Field(
        default="Not specified", description="Office city/region or Remote, plus commute/relocation rules"
    )
    work_mode: str = Field(default="Not specified", description="On-site / Hybrid / Remote")
    work_authorization: str = Field(
        default="Not specified", description="Visa / right-to-work / employment-type requirements"
    )
    education: str = Field(
        default="Not specified", description="Degree level and field if specified"
    )
    must_haves: List[str] = Field(
        default_factory=list,
        description="Hard requirements beyond skills (certifications, licenses, availability, shift, notice, authorization)",
    )
    nice_to_haves: List[str] = Field(
        default_factory=list, description="Additional desirable qualities that are not blockers"
    )
    compensation_budget: str = Field(
        default="Not specified", description="Budget if provided (flag-only, never a rejection reason)"
    )


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
    error_message = Column(Text, nullable=True)  # last failure, shown in UI on Error
    final_report = Column(Text, nullable=True)  # Kept for legacy or high-level summary
    created_at = Column(DateTime(timezone=True), default=utcnow)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    purged_at = Column(DateTime(timezone=True), nullable=True)  # retention purge ran

    company = relationship("Company", back_populates="campaigns")
    candidates = relationship(
        "Candidate", back_populates="campaign", cascade="all, delete-orphan"
    )


class AuditLog(Base):
    """Who did what, when — compliance trail for sensitive actions
    (gender-restricted campaigns, outreach approvals, retention purges, ...)."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)
    user_id = Column(Integer, nullable=True)  # null for system actions (purge job)
    user_email = Column(String, nullable=True)  # denormalized: survives user deletion
    company_id = Column(Integer, nullable=True, index=True)
    action = Column(String, nullable=False, index=True)
    detail = Column(JSON, nullable=True)


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
    needs_info = Column(Text, nullable=True)  # JSON list: unverifiable hard filters
    flags = Column(Text, nullable=True)  # JSON list: over_budget, overqualified, ...
    email_draft = Column(Text, nullable=True)
    sms_draft = Column(Text, nullable=True)
    outreach_approved = Column(Boolean, default=False, nullable=False)

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
