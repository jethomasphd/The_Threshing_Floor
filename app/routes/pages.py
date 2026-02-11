"""Page routes — serves Jinja2 templates for each section."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.database import get_db
from app.models.tables import CollectionJob
from app.services.collector import CollectionService
from app.services.reddit_client import get_reddit_client

router = APIRouter()


def _is_configured() -> bool:
    """Check whether Reddit API credentials are configured.

    Returns:
        True if all three credential fields are set.
    """
    settings = get_settings()
    return bool(
        settings.REDDIT_CLIENT_ID
        and settings.REDDIT_CLIENT_SECRET
        and settings.REDDIT_USER_AGENT
    )


def _page_context(request: Request, **extra: object) -> dict:
    """Build common template context for all page routes.

    Includes `credentials_configured` so every template can react
    to setup state (e.g. showing a banner or setup wizard).

    Args:
        request: The incoming FastAPI request.
        **extra: Additional template context variables.

    Returns:
        Template context dictionary.
    """
    ctx: dict = {
        "request": request,
        "credentials_configured": _is_configured(),
    }
    ctx.update(extra)
    return ctx


@router.get("/")
async def floor(request: Request):
    """The Floor — main dashboard."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/floor.html", _page_context(request),
    )


@router.get("/explore")
async def explore(request: Request):
    """Explore — scout the field, discover subreddits for research.

    Passes credential status so the page can show a helpful setup
    prompt if Reddit API credentials are not yet configured.
    """
    templates = request.app.state.templates
    client = get_reddit_client()
    is_configured = client._client is not None
    return templates.TemplateResponse(
        "pages/explore.html",
        _page_context(request, is_configured=is_configured),
    )


@router.get("/thresh")
async def thresh(
    request: Request,
    subreddit: Optional[str] = Query(None, description="Pre-fill subreddit name"),
    db: Session = Depends(get_db),
):
    """Thresh — configure and run collection.

    Accepts an optional ?subreddit= query parameter to pre-fill
    the collection form (e.g. when navigating from Explore).
    Loads recent collection jobs for the sidebar panel.

    Args:
        request: The incoming FastAPI request.
        subreddit: Optional subreddit name to pre-fill in the form.
        db: Database session.
    """
    templates = request.app.state.templates

    # Load recent jobs
    client = get_reddit_client()
    service = CollectionService(reddit_client=client, db_session=db)
    recent_jobs = service.get_recent_jobs(limit=10)

    return templates.TemplateResponse(
        "pages/thresh.html",
        _page_context(
            request,
            subreddit=subreddit or "",
            recent_jobs=recent_jobs,
        ),
    )


@router.get("/harvest")
async def harvest(request: Request):
    """Harvest — view collected data."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/harvest.html", _page_context(request),
    )


@router.get("/winnow")
async def winnow(request: Request):
    """Winnow — filter and analyze."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/winnow.html", _page_context(request),
    )


@router.get("/glean")
async def glean(request: Request):
    """Glean — export and provenance."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/glean.html", _page_context(request),
    )


@router.get("/about")
async def about(request: Request):
    """About — tool information, ethical guidelines, and credential setup."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/about.html", _page_context(request),
    )
