import json
from sqlalchemy import Column, Integer, String, Text, Float, Boolean
from sqlalchemy.orm import relationship
from pydantic import BaseModel, Field
from typing import List, Optional
from .database import Base

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
class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    threshold = Column(Float, default=65.0)
    jd_text = Column(Text)
    status = Column(String, default="Pending") # Pending, Processing, Completed, Error
    final_report = Column(Text, nullable=True) # Kept for legacy or high-level summary

class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer)
    original_filename = Column(String)
    parsed_text = Column(Text)
    
    # New structured evaluation fields
    name = Column(String, nullable=True)
    score = Column(Integer, nullable=True)
    recommendation = Column(String, nullable=True)
    hard_filter_failed = Column(Boolean, default=False)
    key_strengths = Column(Text, nullable=True) # Stored as JSON string
    key_gaps = Column(Text, nullable=True) # Stored as JSON string
    rationale = Column(Text, nullable=True)
    email_draft = Column(Text, nullable=True)
    sms_draft = Column(Text, nullable=True)

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

