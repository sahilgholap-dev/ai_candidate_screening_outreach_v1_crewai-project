import os


from crewai import LLM
from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task
from ai_candidate_screening_outreach.db.models import CampaignResults







@CrewBase
class AiCandidateScreeningOutreachCrew:
    """AiCandidateScreeningOutreach crew"""

    
    @agent
    def senior_technical_recruiter(self) -> Agent:
        
        
        return Agent(
            config=self.agents_config["senior_technical_recruiter"],
            
            
            tools=[],
            
            reasoning=False,
            max_reasoning_attempts=None,
            inject_date=True,
            allow_delegation=False,
            max_iter=25,
            max_rpm=None,
            
            
            max_execution_time=None,
            llm=LLM(
                model="anthropic/claude-sonnet-4-6",
                
                
            ),
            
        )
        
    
    @agent
    def resume_data_extraction_specialist(self) -> Agent:
        
        
        return Agent(
            config=self.agents_config["resume_data_extraction_specialist"],
            
            
            tools=[],
            
            reasoning=False,
            max_reasoning_attempts=None,
            inject_date=True,
            allow_delegation=False,
            max_iter=25,
            max_rpm=None,
            
            
            max_execution_time=None,
            llm=LLM(
                model="anthropic/claude-sonnet-4-6",
                
                
            ),
            
        )
        
    
    @agent
    def candidate_assessment_expert(self) -> Agent:
        
        
        return Agent(
            config=self.agents_config["candidate_assessment_expert"],
            
            
            tools=[],
            
            reasoning=False,
            max_reasoning_attempts=None,
            inject_date=True,
            allow_delegation=False,
            max_iter=25,
            max_rpm=None,
            
            
            max_execution_time=None,
            llm=LLM(
                model="anthropic/claude-sonnet-4-6",
                temperature=0.2,
                
            ),
            
        )
        
    
    @agent
    def talent_outreach_specialist(self) -> Agent:
        
        
        return Agent(
            config=self.agents_config["talent_outreach_specialist"],
            
            
            tools=[],
            
            reasoning=False,
            max_reasoning_attempts=None,
            inject_date=True,
            allow_delegation=False,
            max_iter=25,
            max_rpm=None,
            
            
            max_execution_time=None,
            llm=LLM(
                model="anthropic/claude-sonnet-4-6",
                
                
            ),
            
        )
        
    

    
    @task
    def extract_job_requirements(self) -> Task:
        return Task(
            config=self.tasks_config["extract_job_requirements"],
            markdown=False,
            output_file="requirements.md"
        )
    
    @task
    def parse_candidate_resumes(self) -> Task:
        return Task(
            config=self.tasks_config["parse_candidate_resumes"],
            markdown=False,
            output_file="parsed.md"
        )
    
    @task
    def evaluate_and_score_candidates(self) -> Task:
        return Task(
            config=self.tasks_config["evaluate_and_score_candidates"],
            markdown=False,
            output_file="report.md"
        )
    
    @task
    def draft_candidate_outreach_messages(self) -> Task:
        return Task(
            config=self.tasks_config["draft_candidate_outreach_messages"],
            output_pydantic=CampaignResults,
            markdown=False,
            output_file="outreach.md"
        )
    

    @crew
    def crew(self) -> Crew:
        """Creates the AiCandidateScreeningOutreach crew"""

        return Crew(
            agents=self.agents,  # Automatically created by the @agent decorator
            tasks=self.tasks,  # Automatically created by the @task decorator
            process=Process.sequential,
            verbose=True,

            chat_llm=LLM(model="anthropic/claude-sonnet-4-6"),
        )


