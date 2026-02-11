"""API routes — JSON endpoints for HTMX and programmatic access."""

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    settings = get_settings()
    return {"status": "ok", "version": settings.THRESH_VERSION}
