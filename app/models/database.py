"""SQLAlchemy 2.0 database setup."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""
    pass


def _get_engine():
    """Create the SQLAlchemy engine from settings."""
    settings = get_settings()
    db_url = f"sqlite:///{settings.THRESH_DB_PATH}"
    return create_engine(db_url, connect_args={"check_same_thread": False}, echo=settings.THRESH_DEBUG)


engine = _get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Create all tables defined by ORM models."""
    # Import tables so they register with Base.metadata
    import app.models.tables  # noqa: F401
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
