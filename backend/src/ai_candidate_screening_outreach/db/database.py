import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

# SQLite for now; switch to Postgres later by setting DATABASE_URL — no code change needed.
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./campaigns.db")

IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
)

if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # WAL: readers don't block while the pipeline worker writes
        cursor.execute("PRAGMA journal_mode=WAL")
        # SQLite ships with FK enforcement off; we rely on ON DELETE CASCADE
        cursor.execute("PRAGMA foreign_keys=ON")
        # Wait up to 5s on a locked database instead of failing immediately
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
