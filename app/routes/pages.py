"""Page routes — serves Jinja2 templates for each section."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.models.tables import CollectionJob, ExportRecord, SavedQuery
from app.services.collector import CollectionService
from app.services.reddit_client import get_reddit_client, has_api_credentials

router = APIRouter()


def _page_context(request: Request, **extra: object) -> dict:
    """Build common template context for all page routes.

    Includes `credentials_configured` so templates can show the optional
    API credential upgrade prompt where relevant.

    Args:
        request: The incoming FastAPI request.
        **extra: Additional template context variables.

    Returns:
        Template context dictionary.
    """
    ctx: dict = {
        "request": request,
        "credentials_configured": has_api_credentials(),
    }
    ctx.update(extra)
    return ctx


@router.get("/")
async def floor(request: Request, db: Session = Depends(get_db)):
    """The Floor — main dashboard.

    Args:
        request: The incoming FastAPI request.
        db: Database session.
    """
    templates = request.app.state.templates

    recent_jobs = (
        db.query(CollectionJob)
        .order_by(CollectionJob.id.desc())
        .limit(5)
        .all()
    )

    saved_queries = (
        db.query(SavedQuery)
        .order_by(SavedQuery.created_at.desc())
        .all()
    )

    recent_exports = (
        db.query(ExportRecord)
        .order_by(ExportRecord.exported_at.desc())
        .limit(5)
        .all()
    )

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
    """Explore — scout the field, discover subreddits."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/explore.html",
        _page_context(request),
    )


@router.get("/thresh")
async def thresh(
    request: Request,
    subreddit: Optional[str] = Query(None, description="Pre-fill subreddit name"),
    db: Session = Depends(get_db),
):
    """Thresh — configure and run collection.

    Args:
        request: The incoming FastAPI request.
        subreddit: Optional subreddit name to pre-fill in the form.
        db: Database session.
    """
    templates = request.app.state.templates

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

    Args:
        request: The incoming FastAPI request.
        job_id: Optional job ID to pre-select in the viewer.
        db: Database session.
    """
    templates = request.app.state.templates

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
async def winnow(
    request: Request,
    job_id: Optional[int] = Query(None, description="Pre-select a collection job"),
    db: Session = Depends(get_db),
):
    """Winnow — analysis tools for collected data.

    Args:
        request: The incoming FastAPI request.
        job_id: Optional job ID to pre-select for analysis.
        db: Database session.
    """
    templates = request.app.state.templates

    jobs = (
        db.query(CollectionJob)
        .filter(CollectionJob.status == "completed")
        .order_by(CollectionJob.completed_at.desc())
        .all()
    )

    return templates.TemplateResponse(
        "pages/winnow.html",
        _page_context(
            request,
            jobs=jobs,
            selected_job_id=job_id,
        ),
    )


@router.get("/glean")
async def glean(
    request: Request,
    job_id: Optional[int] = Query(None, description="Pre-select a collection job for export"),
    db: Session = Depends(get_db),
):
    """Glean — export with provenance.

    Args:
        request: The incoming FastAPI request.
        job_id: Optional job ID to pre-select for export.
        db: Database session.
    """
    templates = request.app.state.templates

    completed_jobs = (
        db.query(CollectionJob)
        .filter(CollectionJob.status == "completed")
        .order_by(CollectionJob.completed_at.desc())
        .all()
    )

    previous_exports = (
        db.query(ExportRecord)
        .order_by(ExportRecord.exported_at.desc())
        .limit(25)
        .all()
    )

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
    """About — tool information, ethical guidelines, and optional credential setup."""
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "pages/about.html", _page_context(request),
    )
