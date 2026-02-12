"""Page routes — serves Jinja2 templates for each section."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.database import get_db
from app.models.tables import CollectionJob, ExportRecord, SavedQuery
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
async def floor(request: Request, db: Session = Depends(get_db)):
    """The Floor — main dashboard.

    Loads recent collection jobs, saved queries, and recent exports
    to populate the dashboard. When no activity exists, the template
    shows a welcome banner instead.

    Args:
        request: The incoming FastAPI request.
        db: Database session.
    """
    templates = request.app.state.templates

    # Recent collection jobs (last 5)
    recent_jobs = (
        db.query(CollectionJob)
        .order_by(CollectionJob.id.desc())
        .limit(5)
        .all()
    )

    # Saved queries
    saved_queries = (
        db.query(SavedQuery)
        .order_by(SavedQuery.created_at.desc())
        .all()
    )

    # Recent exports (last 5)
    recent_exports = (
        db.query(ExportRecord)
        .order_by(ExportRecord.exported_at.desc())
        .limit(5)
        .all()
    )

    # Load associated job data for exports (subreddit name)
    export_jobs: dict[int, CollectionJob] = {}
    for export in recent_exports:
        if export.job_id not in export_jobs:
            job = db.query(CollectionJob).filter(CollectionJob.id == export.job_id).first()
            if job:
                export_jobs[export.job_id] = job

    has_activity = bool(recent_jobs or saved_queries or recent_exports)

    return templates.TemplateResponse(
        "pages/floor.html",
        _page_context(
            request,
            recent_jobs=recent_jobs,
            saved_queries=saved_queries,
            recent_exports=recent_exports,
            export_jobs=export_jobs,
            has_activity=has_activity,
        ),
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
async def harvest(
    request: Request,
    job_id: Optional[int] = Query(None, description="Pre-select a collection job"),
    db: Session = Depends(get_db),
):
    """Harvest — view collected data.

    Loads completed collection jobs so the user can select one to
    browse. Accepts an optional ?job_id= query param to pre-select
    a specific job (e.g. when navigating from the Thresh page after
    a collection completes).

    Args:
        request: The incoming FastAPI request.
        job_id: Optional job ID to pre-select in the viewer.
        db: Database session.
    """
    templates = request.app.state.templates

    # Load completed jobs
    jobs = (
        db.query(CollectionJob)
        .filter(CollectionJob.status == "completed")
        .order_by(CollectionJob.completed_at.desc())
        .all()
    )

    return templates.TemplateResponse(
        "pages/harvest.html",
        _page_context(
            request,
            jobs=jobs,
            selected_job_id=job_id,
        ),
    )


@router.get("/winnow")
async def winnow(request: Request):
    """Winnow — filter and analyze."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/winnow.html", _page_context(request),
    )


@router.get("/glean")
async def glean(
    request: Request,
    job_id: Optional[int] = Query(None, description="Pre-select a collection job for export"),
    db: Session = Depends(get_db),
):
    """Glean — export with provenance.

    Loads completed collection jobs so the user can select one to
    export. Also loads previous export records. Accepts an optional
    ?job_id= query param to pre-select a specific job.

    Args:
        request: The incoming FastAPI request.
        job_id: Optional job ID to pre-select for export.
        db: Database session.
    """
    templates = request.app.state.templates

    # Load completed jobs
    completed_jobs = (
        db.query(CollectionJob)
        .filter(CollectionJob.status == "completed")
        .order_by(CollectionJob.completed_at.desc())
        .all()
    )

    # Load previous exports with their job info
    previous_exports = (
        db.query(ExportRecord)
        .order_by(ExportRecord.exported_at.desc())
        .limit(25)
        .all()
    )

    # Build job lookup for export display
    export_jobs: dict[int, CollectionJob] = {}
    for export in previous_exports:
        if export.job_id not in export_jobs:
            ejob = db.query(CollectionJob).filter(CollectionJob.id == export.job_id).first()
            if ejob:
                export_jobs[export.job_id] = ejob

    return templates.TemplateResponse(
        "pages/glean.html",
        _page_context(
            request,
            completed_jobs=completed_jobs,
            previous_exports=previous_exports,
            export_jobs=export_jobs,
            selected_job_id=job_id,
        ),
    )


@router.get("/about")
async def about(request: Request):
    """About — tool information, ethical guidelines, and credential setup."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/about.html", _page_context(request),
    )
