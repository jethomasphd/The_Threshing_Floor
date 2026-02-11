"""Page routes — serves Jinja2 templates for each section."""

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/")
async def floor(request: Request):
    """The Floor — main dashboard."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/floor.html", {"request": request})


@router.get("/explore")
async def explore(request: Request):
    """Explore — browse subreddits."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/explore.html", {"request": request})


@router.get("/thresh")
async def thresh(request: Request):
    """Thresh — configure and run collection."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/thresh.html", {"request": request})


@router.get("/harvest")
async def harvest(request: Request):
    """Harvest — view collected data."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/harvest.html", {"request": request})


@router.get("/winnow")
async def winnow(request: Request):
    """Winnow — filter and analyze."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/winnow.html", {"request": request})


@router.get("/glean")
async def glean(request: Request):
    """Glean — export and provenance."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/glean.html", {"request": request})


@router.get("/about")
async def about(request: Request):
    """About — tool information."""
    templates = request.app.state.templates
    return templates.TemplateResponse("pages/about.html", {"request": request})
