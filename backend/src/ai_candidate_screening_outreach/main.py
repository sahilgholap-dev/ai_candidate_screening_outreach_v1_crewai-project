#!/usr/bin/env python
import sys
from ai_candidate_screening_outreach.crew import AiCandidateScreeningOutreachCrew

# This main file is intended to be a way for your to run your
# crew locally, so refrain from adding unnecessary logic into this file.
# Replace with inputs you want to test with, it will automatically
# interpolate any tasks and agents information

import os
from ai_candidate_screening_outreach.db.database import SessionLocal
from ai_candidate_screening_outreach.db.models import Campaign, Candidate
from ai_candidate_screening_outreach.utils.parser import format_resumes_for_crewai

import time
import shutil
from ai_candidate_screening_outreach.utils.parser import extract_text_from_pdf, extract_text_from_docx

def run_campaign_task(campaign_id: int, upload_dir: str = None, jd_path: str = None):
    """
    Run the crew for a specific campaign via FastAPI background task, with batch processing for bulk uploads.
    """
    db = SessionLocal()
    campaign = None
    try:
        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if not campaign:
            return
            
        # Parse JD if provided
        if jd_path and os.path.exists(jd_path):
            if jd_path.endswith('.pdf'):
                with open(jd_path, 'rb') as f:
                    campaign.jd_text = extract_text_from_pdf(f.read())
            elif jd_path.endswith('.docx'):
                with open(jd_path, 'rb') as f:
                    campaign.jd_text = extract_text_from_docx(f.read())
            else:
                with open(jd_path, 'r', encoding='utf-8', errors='ignore') as f:
                    campaign.jd_text = f.read()
            db.commit()

        candidates = db.query(Candidate).filter(Candidate.campaign_id == campaign_id).all()
        
        # Parse resumes if not parsed yet
        if upload_dir and os.path.exists(upload_dir):
            for candidate in candidates:
                if not candidate.parsed_text:
                    file_path = os.path.join(upload_dir, candidate.original_filename)
                    if os.path.exists(file_path):
                        if file_path.endswith('.pdf'):
                            with open(file_path, 'rb') as f:
                                candidate.parsed_text = extract_text_from_pdf(f.read())
                        elif file_path.endswith('.docx'):
                            with open(file_path, 'rb') as f:
                                candidate.parsed_text = extract_text_from_docx(f.read())
                        else:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                candidate.parsed_text = f.read()
            db.commit()

        # Batch processing (Chunk size 2)
        BATCH_SIZE = 2
        final_content = ""
        output_dir = f"outputs/campaign_{campaign_id}"
        os.makedirs(output_dir, exist_ok=True)
        
        def process_output_file(filename: str, stage_title: str, include_in_report: bool, chunk_dir_path: str):
            nonlocal final_content
            if os.path.exists(filename):
                if include_in_report:
                    with open(filename, "r", encoding="utf-8") as f:
                        final_content += f"## {stage_title}\n\n{f.read()}\n\n---\n\n"
                # Move to chunk folder
                os.replace(filename, os.path.join(chunk_dir_path, filename))
        
        for i in range(0, len(candidates), BATCH_SIZE):
            chunk = candidates[i:i + BATCH_SIZE]
            resumes_text = format_resumes_for_crewai(chunk)
            
            inputs = {
                'job_description': campaign.jd_text,
                'resumes': resumes_text,
                'threshold': str(campaign.threshold)
            }
            
            # Run CrewAI for this chunk
            result = AiCandidateScreeningOutreachCrew().crew().kickoff(inputs=inputs)
            
            # Parse Pydantic output and update database
            if result.pydantic and hasattr(result.pydantic, 'evaluations'):
                for eval_data in result.pydantic.evaluations:
                    # Find corresponding Candidate by ID
                    candidate = db.query(Candidate).filter(
                        Candidate.id == eval_data.candidate_id,
                        Candidate.campaign_id == campaign_id
                    ).first()
                    
                    if candidate:
                        candidate.name = eval_data.name
                        candidate.score = eval_data.score
                        candidate.recommendation = eval_data.recommendation
                        candidate.hard_filter_failed = eval_data.hard_filter_failed
                        candidate.set_strengths(eval_data.key_strengths)
                        candidate.set_gaps(eval_data.key_gaps)
                        candidate.rationale = eval_data.rationale
                        candidate.email_draft = eval_data.email_draft
                        candidate.sms_draft = eval_data.sms_draft
                        
            db.commit()
            
            # Handle intermediate files for this chunk
            chunk_dir = os.path.join(output_dir, f"chunk_{i//BATCH_SIZE + 1}")
            os.makedirs(chunk_dir, exist_ok=True)
            
            final_content += f"# Batch {i//BATCH_SIZE + 1}\n\n"
            
            process_output_file("requirements.md", "Stage 1: Extracted Job Requirements", True, chunk_dir)
            process_output_file("parsed.md", "Stage 2: Parsed Candidate Resumes", True, chunk_dir)
            process_output_file("report.md", "Stage 3: Candidate Evaluation Report", True, chunk_dir)
            process_output_file("outreach.md", "Stage 4: Outreach Drafts Output", False, chunk_dir)
            
            # Sleep to prevent rate limiting (except after last chunk)
            if i + BATCH_SIZE < len(candidates):
                time.sleep(10)
                
        # End of batch processing
        campaign.final_report = final_content
        campaign.status = "Completed"
        db.commit()
        
        # Cleanup temp uploads
        if upload_dir and os.path.exists(upload_dir):
            shutil.rmtree(upload_dir)
            
    except Exception as e:
        print(f"Error running campaign: {e}")
        if campaign:
            campaign.status = "Error"
            db.commit()
    finally:
        db.close()

def run():
    """
    Run the crew.
    """
    inputs = {
        'job_description': 'sample_value',
        'resumes': 'sample_value',
        'threshold': 'sample_value'
    }
    AiCandidateScreeningOutreachCrew().crew().kickoff(inputs=inputs)


def train():
    """
    Train the crew for a given number of iterations.
    """
    inputs = {
        'job_description': 'sample_value',
        'resumes': 'sample_value',
        'threshold': 'sample_value'
    }
    try:
        AiCandidateScreeningOutreachCrew().crew().train(n_iterations=int(sys.argv[1]), filename=sys.argv[2], inputs=inputs)

    except Exception as e:
        raise Exception(f"An error occurred while training the crew: {e}")

def replay():
    """
    Replay the crew execution from a specific task.
    """
    try:
        AiCandidateScreeningOutreachCrew().crew().replay(task_id=sys.argv[1])

    except Exception as e:
        raise Exception(f"An error occurred while replaying the crew: {e}")

def test():
    """
    Test the crew execution and returns the results.
    """
    inputs = {
        'job_description': 'sample_value',
        'resumes': 'sample_value',
        'threshold': 'sample_value'
    }
    try:
        AiCandidateScreeningOutreachCrew().crew().test(n_iterations=int(sys.argv[1]), openai_model_name=sys.argv[2], inputs=inputs)

    except Exception as e:
        raise Exception(f"An error occurred while testing the crew: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: main.py <command> [<args>]")
        sys.exit(1)

    command = sys.argv[1]
    if command == "run":
        run()
    elif command == "train":
        train()
    elif command == "replay":
        replay()
    elif command == "test":
        test()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
