"""Shared test fixtures for The Threshing Floor."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import create_app
from app.models.database import Base


@pytest.fixture
def test_app():
    """Create a fresh Thresh application for testing."""
    application = create_app()
    return application


@pytest.fixture
async def test_client(test_app):
    """Async HTTP test client backed by the test app."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest.fixture
def test_db():
    """In-memory SQLite database for isolated tests."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Import tables so metadata is populated
    import app.models.tables  # noqa: F401
    Base.metadata.create_all(bind=engine)

    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
