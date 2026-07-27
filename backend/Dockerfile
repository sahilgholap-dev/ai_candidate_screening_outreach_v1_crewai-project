FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.25 /uv /uvx /bin/

WORKDIR /app

# Install dependencies first so this layer caches across code changes
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen --no-install-project

COPY . .
RUN uv sync --no-dev --frozen

# Shell form so $PORT (injected by Railway) expands
CMD uv run alembic upgrade head && uv run uvicorn ai_candidate_screening_outreach.app:app --host 0.0.0.0 --port $PORT
