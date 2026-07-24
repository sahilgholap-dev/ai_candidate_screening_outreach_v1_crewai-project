import io
from pypdf import PdfReader
from docx import Document

def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text.strip()
    except Exception as e:
        print(f"Error extracting PDF: {e}")
        return ""

def extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        doc = Document(io.BytesIO(file_bytes))
        text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"Error extracting DOCX: {e}")
        return ""

def format_resumes_for_crewai(candidates: list) -> str:
    """
    Format multiple resume strings into the format expected by the CrewAI prompt:
    'resumes separated by a line containing only ---'
    """
    formatted = []
    for c in candidates:
        formatted.append(f"Candidate ID: {c.id}\n{c.parsed_text}")
    return "\n---\n".join(formatted)
