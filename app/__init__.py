"""The Threshing Floor — academic Reddit research tool."""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Create and configure the Thresh application."""
    app = FastAPI(
        title="The Threshing Floor",
        description="Separate the wheat from the feed.",
        version="0.1.0",
    )

    # Static files
    static_dir = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    # Templates
    templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
    app.state.templates = templates

    # Database init
    from app.models.database import init_db
    init_db()

    # Routes
    from app.routes.pages import router as pages_router
    from app.routes.api import router as api_router
    app.include_router(pages_router)
    app.include_router(api_router, prefix="/api")

    logger.info("The Threshing Floor is ready.")
    return app
