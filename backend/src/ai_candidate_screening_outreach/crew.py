from crewai import LLM, Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task

from ai_candidate_screening_outreach.db.models import CampaignResults, UnifiedRequirements

MODEL = "anthropic/claude-sonnet-4-6"


def _llm(temperature: float | None = None) -> LLM:
    kwargs = {"model": MODEL}
    if temperature is not None:
        kwargs["temperature"] = temperature
    return LLM(**kwargs)


@CrewBase
class RequirementsCrew:
    """Stage 1 — runs ONCE per campaign: merges the JD with the recruiter's
    structured requirements into a Unified Requirements Profile."""

    agents_config = "config/agents_requirements.yaml"
    tasks_config = "config/tasks_requirements.yaml"

    @agent
    def senior_technical_recruiter(self) -> Agent:
        return Agent(
            config=self.agents_config["senior_technical_recruiter"],
            inject_date=True,
            allow_delegation=False,
            # temperature 0: the profile is the rubric every candidate is
            # scored against; run-to-run drift here swings scores 20+ points.
            llm=_llm(temperature=0.0),
        )

    @task
    def extract_job_requirements(self) -> Task:
        return Task(
            config=self.tasks_config["extract_job_requirements"],
            output_pydantic=UnifiedRequirements,
        )

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )


@CrewBase
class ScreeningCrew:
    """Stages 2–4 — runs per chunk of resumes: parse, evaluate against the
    unified requirements, and draft outreach for shortlisted candidates."""

    agents_config = "config/agents_screening.yaml"
    tasks_config = "config/tasks_screening.yaml"

    @agent
    def resume_data_extraction_specialist(self) -> Agent:
        return Agent(
            config=self.agents_config["resume_data_extraction_specialist"],
            inject_date=True,
            allow_delegation=False,
            llm=_llm(),
        )

    @agent
    def candidate_assessment_expert(self) -> Agent:
        return Agent(
            config=self.agents_config["candidate_assessment_expert"],
            inject_date=True,
            allow_delegation=False,
            llm=_llm(temperature=0.0),
        )

    @agent
    def talent_outreach_specialist(self) -> Agent:
        return Agent(
            config=self.agents_config["talent_outreach_specialist"],
            inject_date=True,
            allow_delegation=False,
            llm=_llm(),
        )

    @task
    def parse_candidate_resumes(self) -> Task:
        return Task(config=self.tasks_config["parse_candidate_resumes"])

    @task
    def evaluate_and_score_candidates(self) -> Task:
        return Task(config=self.tasks_config["evaluate_and_score_candidates"])

    @task
    def draft_candidate_outreach_messages(self) -> Task:
        return Task(
            config=self.tasks_config["draft_candidate_outreach_messages"],
            output_pydantic=CampaignResults,
        )

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )
