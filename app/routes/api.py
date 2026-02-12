"""API routes — HTML partial endpoints for HTMX and programmatic access."""

import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import desc, asc
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.database import SessionLocal, get_db
from app.models.schemas import CollectionConfig
from app.models.tables import CollectedComment, CollectedPost, CollectionJob, ExportRecord, SavedQuery
from app.services.collector import CollectionService
from app.services.reddit_client import get_reddit_client

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    settings = get_settings()
    return {"status": "ok", "version": settings.THRESH_VERSION}


@router.get("/setup/status")
async def setup_status() -> JSONResponse:
    """Check if Reddit API credentials are configured.

    Returns:
        JSON with {"configured": bool}.
    """
    settings = get_settings()
    configured = bool(
        settings.REDDIT_CLIENT_ID
        and settings.REDDIT_CLIENT_SECRET
        and settings.REDDIT_USER_AGENT
    )
    return JSONResponse({"configured": configured})


@router.post("/setup/validate", response_class=HTMLResponse)
async def setup_validate(
    request: Request,
    client_id: str = Form(""),
    client_secret: str = Form(""),
    user_agent: str = Form(""),
) -> HTMLResponse:
    """Test Reddit credentials without saving.

    Creates a temporary PRAW instance and verifies authentication.
    Returns an HTML partial for HTMX swap.

    Args:
        request: The incoming request.
        client_id: Reddit app client ID.
        client_secret: Reddit app client secret.
        user_agent: User agent string for Reddit API.
    """
    # Validate that all fields are provided
    if not client_id.strip():
        return HTMLResponse(_render_setup_result(
            success=False,
            message="Client ID is required. You can find it under your app name on the Reddit apps page.",
        ))

    if not client_secret.strip():
        return HTMLResponse(_render_setup_result(
            success=False,
            message="Client Secret is required. It is listed as the \"secret\" on your Reddit app page.",
        ))

    if not user_agent.strip():
        return HTMLResponse(_render_setup_result(
            success=False,
            message="User Agent is required. Reddit needs this to identify your application.",
        ))

    # Try to authenticate with the provided credentials
    try:
        import praw
        import prawcore

        test_client = praw.Reddit(
            client_id=client_id.strip(),
            client_secret=client_secret.strip(),
            user_agent=user_agent.strip(),
        )
        # Trigger an actual API call to verify credentials
        test_client.auth.scopes()
        return HTMLResponse(_render_setup_result(
            success=True,
            message="Connected successfully! Your Reddit API credentials are valid.",
        ))
    except prawcore.exceptions.OAuthException:
        return HTMLResponse(_render_setup_result(
            success=False,
            message="Authentication failed. Please double-check your Client ID and Client Secret.",
        ))
    except prawcore.exceptions.ResponseException:
        return HTMLResponse(_render_setup_result(
            success=False,
            message="Reddit rejected the credentials. Verify that your app type is set to \"script\" and your Client ID and Secret are correct.",
        ))
    except prawcore.exceptions.RequestException:
        return HTMLResponse(_render_setup_result(
            success=False,
            message="Could not reach Reddit. Please check your internet connection and try again.",
        ))
    except Exception as e:
        logger.error(f"Unexpected error during credential validation: {e}")
        return HTMLResponse(_render_setup_result(
            success=False,
            message=f"An unexpected error occurred: {str(e)}",
        ))


@router.post("/setup/save", response_class=HTMLResponse)
async def setup_save(
    request: Request,
    client_id: str = Form(""),
    client_secret: str = Form(""),
    user_agent: str = Form(""),
) -> HTMLResponse:
    """Save validated Reddit credentials to .env file.

    Validates credentials first, then writes them to the project .env file.
    Clears the settings cache so the app picks up the new values.

    Args:
        request: The incoming request.
        client_id: Reddit app client ID.
        client_secret: Reddit app client secret.
        user_agent: User agent string for Reddit API.
    """
    client_id = client_id.strip()
    client_secret = client_secret.strip()
    user_agent = user_agent.strip()

    # Validate before saving
    if not all([client_id, client_secret, user_agent]):
        return HTMLResponse(_render_setup_result(
            success=False,
            message="All three fields are required.",
        ))

    # Verify credentials actually work before saving
    try:
        import praw

        test_client = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
        )
        test_client.auth.scopes()
    except Exception as e:
        logger.error(f"Credential validation failed during save: {e}")
        return HTMLResponse(_render_setup_result(
            success=False,
            message="Could not validate credentials. Please test them first.",
        ))

    # Write credentials to .env file
    try:
        _save_credentials_to_env(client_id, client_secret, user_agent)
    except Exception as e:
        logger.error(f"Failed to write .env file: {e}")
        return HTMLResponse(_render_setup_result(
            success=False,
            message=f"Credentials are valid but could not be saved: {str(e)}",
        ))

    # Clear the settings cache so the app reloads with new credentials
    get_settings.cache_clear()

    # Reset the reddit client singleton so it reinitializes
    from app.services.reddit_client import _reset_client
    _reset_client()

    logger.info("Reddit API credentials saved successfully")

    return HTMLResponse(_render_setup_result(
        success=True,
        message="Credentials saved! Redirecting you to the Floor...",
        redirect="/",
    ))


def _save_credentials_to_env(
    client_id: str,
    client_secret: str,
    user_agent: str,
) -> None:
    """Write Reddit credentials to the .env file safely.

    Reads the existing .env if present, updates or adds the credential
    lines, and writes the file back.

    Args:
        client_id: Reddit app client ID.
        client_secret: Reddit app client secret.
        user_agent: User agent string.
    """
    env_path = Path(".env")
    lines: list[str] = []

    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    # Track which keys we have already updated
    updated_keys: set[str] = set()
    new_lines: list[str] = []

    credentials = {
        "REDDIT_CLIENT_ID": client_id,
        "REDDIT_CLIENT_SECRET": client_secret,
        "REDDIT_USER_AGENT": user_agent,
    }

    for line in lines:
        stripped = line.strip()
        # Check if this line sets one of our credential keys
        matched = False
        for key, value in credentials.items():
            if stripped.startswith(f"{key}=") or stripped.startswith(f"{key} ="):
                new_lines.append(f"{key}={value}")
                updated_keys.add(key)
                matched = True
                break
        if not matched:
            new_lines.append(line)

    # Add any credential lines that were not already present
    for key, value in credentials.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={value}")

    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def _render_setup_result(
    success: bool,
    message: str,
    redirect: Optional[str] = None,
) -> str:
    """Render the setup result HTML partial inline.

    Args:
        success: Whether the operation succeeded.
        message: Human-readable message to display.
        redirect: Optional URL to redirect to after a short delay.

    Returns:
        HTML string for HTMX swap.
    """
    if success:
        icon_svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" '
            'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            'stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>'
            '<polyline points="22 4 12 14.01 9 11.01"/></svg>'
        )
        color_class = "text-success"
        bg_class = "rgba(74, 155, 110, 0.1)"
        border_color = "var(--success)"
        # Enable the save button on successful validation
        enable_save_script = (
            '<script>'
            'document.getElementById("save-btn").disabled = false;'
            '</script>'
        )
    else:
        icon_svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" '
            'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            'stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>'
            '<line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        )
        color_class = "text-error"
        bg_class = "rgba(196, 75, 75, 0.1)"
        border_color = "var(--error)"
        enable_save_script = (
            '<script>'
            'document.getElementById("save-btn").disabled = true;'
            '</script>'
        )

    redirect_script = ""
    if redirect:
        redirect_script = (
            f'<script>setTimeout(function(){{ window.location.href = "{redirect}"; }}, 1500);</script>'
        )

    return (
        f'<div class="flex items-center gap-3 p-3 rounded" '
        f'style="background: {bg_class}; border-left: 3px solid {border_color};">'
        f'<span class="{color_class}">{icon_svg}</span>'
        f'<span class="{color_class}" style="font-size: 0.9375rem;">{message}</span>'
        f'</div>'
        f'{enable_save_script}'
        f'{redirect_script}'
    )


# ---------------------------------------------------------------------------
# Template helper functions for Explore partials
# ---------------------------------------------------------------------------

def _format_subscribers(count: int) -> str:
    """Format subscriber count for display (e.g. 1.2M, 45.3K).

    Args:
        count: Raw subscriber count.

    Returns:
        Human-readable string.
    """
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    elif count >= 1_000:
        return f"{count / 1_000:.1f}K"
    return f"{count:,}"


def _format_score(score: int) -> str:
    """Format post score for compact display.

    Args:
        score: Raw score.

    Returns:
        Human-readable string.
    """
    if score >= 100_000:
        return f"{score / 1_000:.0f}K"
    elif score >= 1_000:
        return f"{score / 1_000:.1f}K"
    return str(score)


def _format_timestamp(utc_timestamp: float) -> str:
    """Format a UTC timestamp to a readable date string.

    Args:
        utc_timestamp: Unix timestamp (UTC).

    Returns:
        Date string like 'Jan 15, 2023'.
    """
    try:
        dt = datetime.fromtimestamp(utc_timestamp, tz=timezone.utc)
        return dt.strftime("%b %d, %Y")
    except (ValueError, OSError):
        return "Unknown"


def _format_datetime(utc_timestamp: float) -> str:
    """Format a UTC timestamp to a full datetime string.

    Args:
        utc_timestamp: Unix timestamp (UTC).

    Returns:
        Full datetime string like 'Jan 15, 2023 at 14:30 UTC'.
    """
    try:
        dt = datetime.fromtimestamp(utc_timestamp, tz=timezone.utc)
        return dt.strftime("%b %d, %Y at %H:%M UTC")
    except (ValueError, OSError):
        return "Unknown"


def _format_relative_time(utc_timestamp: float) -> str:
    """Format a UTC timestamp as a relative time string.

    Args:
        utc_timestamp: Unix timestamp (UTC).

    Returns:
        Relative time like '2h ago', '3d ago'.
    """
    try:
        now = datetime.now(tz=timezone.utc)
        dt = datetime.fromtimestamp(utc_timestamp, tz=timezone.utc)
        seconds = (now - dt).total_seconds()

        if seconds < 60:
            return "just now"
        elif seconds < 3600:
            return f"{int(seconds / 60)}m ago"
        elif seconds < 86400:
            return f"{int(seconds / 3600)}h ago"
        elif seconds < 2_592_000:
            return f"{int(seconds / 86400)}d ago"
        elif seconds < 31_536_000:
            return f"{int(seconds / 2_592_000)}mo ago"
        else:
            return f"{int(seconds / 31_536_000)}y ago"
    except (ValueError, OSError):
        return "Unknown"


def _explore_context(request: Request, **kwargs: object) -> dict:
    """Build a template context dict with Explore helper functions.

    Args:
        request: FastAPI request object.
        **kwargs: Additional context variables.

    Returns:
        Context dictionary for Jinja2 rendering.
    """
    ctx: dict = {
        "request": request,
        "format_subscribers": _format_subscribers,
        "format_score": _format_score,
        "format_timestamp": _format_timestamp,
        "format_datetime": _format_datetime,
        "format_relative_time": _format_relative_time,
    }
    ctx.update(kwargs)
    return ctx


# ---------------------------------------------------------------------------
# Explore — Subreddit Search
# ---------------------------------------------------------------------------

@router.get("/subreddits/search", response_class=HTMLResponse)
async def search_subreddits(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=25, description="Max results"),
) -> HTMLResponse:
    """Search for subreddits matching a query.

    Returns an HTML partial with subreddit cards for HTMX swap.

    Args:
        request: FastAPI request.
        q: Search query string.
        limit: Maximum results to return.
    """
    templates = request.app.state.templates
    client = get_reddit_client()

    try:
        subreddits = client.search_subreddits(query=q, limit=limit)
        return templates.TemplateResponse(
            "partials/subreddit_cards.html",
            _explore_context(request, subreddits=subreddits),
        )
    except ValueError as e:
        logger.warning(f"Credentials error during subreddit search: {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Authentication Error",
                message=str(e),
                show_setup_link=True,
            ),
        )
    except ConnectionError as e:
        logger.warning(f"Network error during subreddit search: {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Connection Error",
                message=str(e),
            ),
        )
    except Exception as e:
        logger.error(f"Unexpected error during subreddit search: {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Search Error",
                message=(
                    "An unexpected error occurred while searching. "
                    "Please try again in a moment."
                ),
            ),
        )


# ---------------------------------------------------------------------------
# Explore — Subreddit Detail
# ---------------------------------------------------------------------------

@router.get("/subreddits/{name}/detail", response_class=HTMLResponse)
async def get_subreddit_detail(
    request: Request,
    name: str,
) -> HTMLResponse:
    """Get full metadata for a subreddit and render the detail panel.

    Args:
        request: FastAPI request.
        name: Subreddit display name (without r/ prefix).
    """
    templates = request.app.state.templates
    client = get_reddit_client()

    try:
        subreddit = client.get_subreddit_meta(name=name)
        return templates.TemplateResponse(
            "partials/subreddit_detail.html",
            _explore_context(request, subreddit=subreddit),
        )
    except ValueError as e:
        logger.warning(f"Error fetching subreddit '{name}': {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Subreddit Not Found",
                message=str(e),
            ),
        )
    except ConnectionError as e:
        logger.warning(f"Network error fetching subreddit '{name}': {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Connection Error",
                message=str(e),
            ),
        )
    except Exception as e:
        logger.error(f"Unexpected error fetching subreddit '{name}': {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Error Loading Subreddit",
                message=(
                    f"Could not load metadata for r/{name}. "
                    "Please try again in a moment."
                ),
            ),
        )


# ---------------------------------------------------------------------------
# Explore — Subreddit Posts Preview
# ---------------------------------------------------------------------------

@router.get("/subreddits/{name}/posts", response_class=HTMLResponse)
async def get_subreddit_posts(
    request: Request,
    name: str,
    sort: str = Query("hot", description="Sort method"),
    time_filter: str = Query("all", description="Time filter for top/controversial"),
    limit: int = Query(10, ge=1, le=50, description="Max posts"),
) -> HTMLResponse:
    """Get recent posts from a subreddit and render post cards.

    Args:
        request: FastAPI request.
        name: Subreddit display name.
        sort: Sort method (hot, new, top, rising, controversial).
        time_filter: Time filter for top/controversial.
        limit: Maximum posts to return.
    """
    templates = request.app.state.templates
    client = get_reddit_client()

    # Validate sort parameter
    valid_sorts = ("hot", "new", "top", "rising", "controversial")
    if sort not in valid_sorts:
        sort = "hot"

    # Validate time_filter
    valid_filters = ("hour", "day", "week", "month", "year", "all")
    if time_filter not in valid_filters:
        time_filter = "all"

    try:
        posts = client.get_posts(
            subreddit=name,
            sort=sort,
            time_filter=time_filter,
            limit=limit,
        )
        return templates.TemplateResponse(
            "partials/post_cards.html",
            _explore_context(request, posts=posts),
        )
    except ValueError as e:
        logger.warning(f"Error fetching posts from r/{name}: {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Authentication Error",
                message=str(e),
                show_setup_link=True,
            ),
        )
    except ConnectionError as e:
        logger.warning(f"Network error fetching posts from r/{name}: {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Connection Error",
                message=str(e),
            ),
        )
    except Exception as e:
        logger.error(f"Unexpected error fetching posts from r/{name}: {e}")
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Error Loading Posts",
                message=(
                    f"Could not load posts from r/{name}. "
                    "Please try again in a moment."
                ),
            ),
        )


# ---------------------------------------------------------------------------
# Thresh — Collection API endpoints
# ---------------------------------------------------------------------------


def _run_collection_background(config: CollectionConfig, job_id: int) -> None:
    """Run a collection job in a background thread.

    Creates its own database session so the background thread is
    independent of the request lifecycle.

    Args:
        config: The collection configuration.
        job_id: ID of the pre-created CollectionJob to update.
    """
    db = SessionLocal()
    try:
        client = get_reddit_client()

        job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
        if job is None:
            logger.error(f"Background collection: job {job_id} not found")
            return

        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db.commit()

        try:
            # Collect posts
            post_data_list = client.get_posts(
                subreddit=config.subreddit,
                sort=config.sort,
                time_filter=config.time_filter,
                limit=config.limit,
                query=config.query if config.query else None,
            )

            collected_posts: list[CollectedPost] = []
            for post_data in post_data_list:
                existing = (
                    db.query(CollectedPost)
                    .filter(CollectedPost.reddit_id == post_data.id)
                    .first()
                )
                if existing is not None:
                    continue

                post = CollectedPost(
                    job_id=job.id,
                    reddit_id=post_data.id,
                    subreddit=post_data.subreddit,
                    title=post_data.title,
                    selftext=post_data.selftext,
                    author=post_data.author,
                    score=post_data.score,
                    num_comments=post_data.num_comments,
                    created_utc=post_data.created_utc,
                    url=post_data.url,
                    permalink=post_data.permalink,
                )
                db.add(post)
                collected_posts.append(post)
                job.collected_posts = len(collected_posts)
                db.commit()

            job.total_posts = len(post_data_list)
            job.collected_posts = len(collected_posts)
            db.commit()

            # Collect comments if requested
            if config.include_comments and collected_posts:
                depth = min(config.comment_depth or 3, 10)
                estimated_comments = sum(
                    p.num_comments for p in collected_posts
                )
                job.total_comments = estimated_comments
                db.commit()

                for collected_post in collected_posts:
                    try:
                        comment_data_list = client.get_comments(
                            post_id=collected_post.reddit_id,
                            depth=depth,
                            limit=100,
                        )
                        for comment_data in comment_data_list:
                            existing = (
                                db.query(CollectedComment)
                                .filter(
                                    CollectedComment.reddit_id == comment_data.id
                                )
                                .first()
                            )
                            if existing is not None:
                                continue

                            comment = CollectedComment(
                                job_id=job.id,
                                reddit_id=comment_data.id,
                                post_reddit_id=collected_post.reddit_id,
                                parent_reddit_id=comment_data.parent_id,
                                author=comment_data.author,
                                body=comment_data.body,
                                score=comment_data.score,
                                created_utc=comment_data.created_utc,
                                depth=comment_data.depth,
                            )
                            db.add(comment)
                            job.collected_comments += 1
                            db.commit()
                    except Exception as e:
                        logger.warning(
                            f"Failed to collect comments for post "
                            f"{collected_post.reddit_id}: {e}"
                        )

            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            db.commit()

            logger.info(
                f"Background collection job {job.id} completed: "
                f"{job.collected_posts} posts, "
                f"{job.collected_comments} comments"
            )

        except Exception as e:
            logger.error(f"Background collection job {job.id} failed: {e}")
            job.status = "failed"
            job.error_message = str(e)
            job.completed_at = datetime.now(timezone.utc)
            db.commit()

    finally:
        db.close()


@router.post("/collect")
async def start_collection(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    subreddit: str = Form(...),
    sort: str = Form("hot"),
    time_filter: str = Form("all"),
    limit: int = Form(25),
    query: Optional[str] = Form(None),
    include_comments: bool = Form(False),
    comment_depth: int = Form(3),
    comment_limit: int = Form(100),
):
    """Start a new collection job.

    Accepts form data, creates a pending CollectionJob, and runs
    the actual collection in a background task. Returns the job
    progress partial for HTMX to swap in.

    Args:
        request: The FastAPI request.
        background_tasks: FastAPI background task runner.
        db: Database session.
        subreddit: Target subreddit name.
        sort: Sort method (hot/new/top/rising/controversial).
        time_filter: Time filter for top/controversial.
        limit: Maximum posts to collect.
        query: Optional keyword search.
        include_comments: Whether to collect comments.
        comment_depth: Comment tree expansion depth.
        comment_limit: Max comments per post.

    Returns:
        HTML partial showing job progress with polling.
    """
    templates = request.app.state.templates

    # Validate subreddit name — strip r/ prefix and whitespace
    subreddit_clean = subreddit.strip()
    if subreddit_clean.startswith("r/"):
        subreddit_clean = subreddit_clean[2:]
    subreddit_clean = subreddit_clean.strip("/").strip()

    if not subreddit_clean:
        return templates.TemplateResponse(
            "partials/job_card.html",
            {
                "request": request,
                "job": None,
                "error": "Please enter a subreddit name.",
            },
        )

    # Clamp values to safe ranges
    limit = max(1, min(limit, 1000))
    comment_depth = max(1, min(comment_depth, 10))
    comment_limit = max(1, min(comment_limit, 500))

    # Build config
    config = CollectionConfig(
        subreddit=subreddit_clean,
        sort=sort,
        time_filter=time_filter,
        limit=limit,
        query=query if query and query.strip() else None,
        include_comments=include_comments,
        comment_depth=comment_depth,
    )

    # Create a pending job record
    job = CollectionJob(
        subreddit=config.subreddit,
        status="pending",
        total_posts=config.limit,
        collected_posts=0,
        total_comments=0,
        collected_comments=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(f"Created collection job {job.id} for r/{subreddit_clean}")

    # Schedule background collection
    background_tasks.add_task(
        _run_collection_background,
        config=config,
        job_id=job.id,
    )

    # Return the progress partial which polls for updates
    return templates.TemplateResponse(
        "partials/job_progress.html",
        {"request": request, "job": job},
    )


@router.get("/collect/{job_id}/status")
async def get_job_status(
    request: Request,
    job_id: int,
    db: Session = Depends(get_db),
):
    """Get current status of a collection job as an HTML partial.

    Used by HTMX polling to update the progress display.

    Args:
        request: The FastAPI request.
        job_id: The collection job ID.
        db: Database session.

    Returns:
        HTML partial with current job status.
    """
    templates = request.app.state.templates

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()

    if job is None:
        return templates.TemplateResponse(
            "partials/job_card.html",
            {
                "request": request,
                "job": None,
                "error": f"Job {job_id} not found.",
            },
        )

    # If still running, return progress partial (continues polling)
    if job.status in ("pending", "running"):
        return templates.TemplateResponse(
            "partials/job_progress.html",
            {"request": request, "job": job},
        )

    # Completed or failed: return the final job card (no more polling)
    return templates.TemplateResponse(
        "partials/job_card.html",
        {"request": request, "job": job},
    )


@router.get("/collect/recent")
async def get_recent_jobs(
    request: Request,
    db: Session = Depends(get_db),
):
    """Get recent collection jobs as HTML partials.

    Returns a list of job cards for the recent jobs panel.

    Args:
        request: The FastAPI request.
        db: Database session.

    Returns:
        HTML partial with recent job cards.
    """
    templates = request.app.state.templates

    client = get_reddit_client()
    service = CollectionService(reddit_client=client, db_session=db)
    jobs = service.get_recent_jobs(limit=10)

    return templates.TemplateResponse(
        "partials/recent_jobs.html",
        {"request": request, "jobs": jobs},
    )


# ---------------------------------------------------------------------------
# Harvest — Results Viewer API Endpoints
# ---------------------------------------------------------------------------

def _harvest_context(request: Request, **kwargs: object) -> dict:
    """Build a template context dict with Harvest helper functions.

    Args:
        request: FastAPI request object.
        **kwargs: Additional context variables.

    Returns:
        Context dictionary for Jinja2 rendering.
    """
    ctx: dict = {
        "request": request,
        "format_score": _format_score,
        "format_timestamp": _format_timestamp,
        "format_datetime": _format_datetime,
        "format_relative_time": _format_relative_time,
    }
    ctx.update(kwargs)
    return ctx


@router.get("/harvest/jobs", response_class=HTMLResponse)
async def harvest_jobs(
    request: Request,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """List all completed collection jobs as an HTML partial.

    Used by the Harvest page job selector dropdown. Returns option
    elements for the select input.

    Args:
        request: FastAPI request.
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
        "partials/harvest_job_options.html",
        _harvest_context(request, jobs=jobs),
    )


@router.get("/harvest/{job_id}/posts", response_class=HTMLResponse)
async def harvest_posts(
    request: Request,
    job_id: int,
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(50, ge=10, le=200, description="Results per page"),
    sort: str = Query("created_utc", description="Sort column"),
    order: str = Query("desc", description="Sort order (asc/desc)"),
    q: Optional[str] = Query(None, description="Keyword search filter"),
    min_score: Optional[int] = Query(None, description="Minimum score filter"),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Get paginated posts for a collection job as an HTML table partial.

    Supports sorting by any column, keyword search on title, and
    minimum score filtering.

    Args:
        request: FastAPI request.
        job_id: The collection job ID.
        page: Page number (1-indexed).
        per_page: Results per page.
        sort: Column name to sort by.
        order: Sort direction (asc/desc).
        q: Optional keyword to filter titles.
        min_score: Optional minimum score filter.
        db: Database session.
    """
    templates = request.app.state.templates

    # Validate the job exists
    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return templates.TemplateResponse(
            "partials/error_message.html",
            _harvest_context(
                request,
                title="Job Not Found",
                message=f"Collection job {job_id} does not exist.",
            ),
        )

    # Build query
    query = db.query(CollectedPost).filter(CollectedPost.job_id == job_id)

    # Apply keyword filter
    if q and q.strip():
        query = query.filter(CollectedPost.title.ilike(f"%{q.strip()}%"))

    # Apply minimum score filter
    if min_score is not None:
        query = query.filter(CollectedPost.score >= min_score)

    # Count total results (after filters)
    total_count = query.count()

    # Validate sort column
    valid_sort_columns = {
        "title": CollectedPost.title,
        "author": CollectedPost.author,
        "score": CollectedPost.score,
        "num_comments": CollectedPost.num_comments,
        "created_utc": CollectedPost.created_utc,
    }
    sort_column = valid_sort_columns.get(sort, CollectedPost.created_utc)

    # Apply sorting
    if order == "asc":
        query = query.order_by(asc(sort_column))
    else:
        query = query.order_by(desc(sort_column))

    # Apply pagination
    offset = (page - 1) * per_page
    posts = query.offset(offset).limit(per_page).all()

    # Calculate pagination metadata
    total_pages = max(1, (total_count + per_page - 1) // per_page)
    start_index = offset + 1 if total_count > 0 else 0
    end_index = min(offset + per_page, total_count)

    # Check which posts have comments
    posts_with_comments: set[str] = set()
    if posts:
        reddit_ids = [p.reddit_id for p in posts]
        comment_counts = (
            db.query(CollectedComment.post_reddit_id)
            .filter(
                CollectedComment.job_id == job_id,
                CollectedComment.post_reddit_id.in_(reddit_ids),
            )
            .distinct()
            .all()
        )
        posts_with_comments = {row[0] for row in comment_counts}

    return templates.TemplateResponse(
        "partials/harvest_table.html",
        _harvest_context(
            request,
            posts=posts,
            posts_with_comments=posts_with_comments,
            job_id=job_id,
            page=page,
            per_page=per_page,
            total_count=total_count,
            total_pages=total_pages,
            start_index=start_index,
            end_index=end_index,
            sort=sort,
            order=order,
            q=q or "",
            min_score=min_score,
        ),
    )


@router.get("/harvest/{job_id}/stats", response_class=HTMLResponse)
async def harvest_stats(
    request: Request,
    job_id: int,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Compute and render statistics sidebar for a collection job.

    Calculates total posts, date range, average score, average comments,
    top authors, and prepares chart canvas IDs.

    Args:
        request: FastAPI request.
        job_id: The collection job ID.
        db: Database session.
    """
    templates = request.app.state.templates

    # Validate job
    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return templates.TemplateResponse(
            "partials/error_message.html",
            _harvest_context(
                request,
                title="Job Not Found",
                message=f"Collection job {job_id} does not exist.",
            ),
        )

    # Get all posts for this job
    posts = (
        db.query(CollectedPost)
        .filter(CollectedPost.job_id == job_id)
        .all()
    )

    total_posts = len(posts)

    if total_posts == 0:
        return templates.TemplateResponse(
            "partials/stats_panel.html",
            _harvest_context(
                request,
                job=job,
                job_id=job_id,
                total_posts=0,
                date_range_start="N/A",
                date_range_end="N/A",
                avg_score=0,
                avg_comments=0,
                top_authors=[],
                total_comments=job.collected_comments,
            ),
        )

    # Date range
    timestamps = [p.created_utc for p in posts]
    min_ts = min(timestamps)
    max_ts = max(timestamps)

    # Averages
    scores = [p.score for p in posts]
    comments = [p.num_comments for p in posts]
    avg_score = sum(scores) / total_posts
    avg_comments = sum(comments) / total_posts

    # Top 5 authors
    author_counts: Counter[str] = Counter()
    for p in posts:
        if p.author != "[deleted]":
            author_counts[p.author] += 1
    top_authors = author_counts.most_common(5)

    return templates.TemplateResponse(
        "partials/stats_panel.html",
        _harvest_context(
            request,
            job=job,
            job_id=job_id,
            total_posts=total_posts,
            date_range_start=_format_timestamp(min_ts),
            date_range_end=_format_timestamp(max_ts),
            avg_score=round(avg_score, 1),
            avg_comments=round(avg_comments, 1),
            top_authors=top_authors,
            total_comments=job.collected_comments,
        ),
    )


@router.get("/harvest/{job_id}/posts/{post_reddit_id}/comments", response_class=HTMLResponse)
async def harvest_comments(
    request: Request,
    job_id: int,
    post_reddit_id: str,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Get threaded comments for a post as an HTML partial.

    Retrieves comments from the database and renders them in a
    threaded layout with depth-based indentation.

    Args:
        request: FastAPI request.
        job_id: The collection job ID.
        post_reddit_id: The Reddit post ID.
        db: Database session.
    """
    templates = request.app.state.templates

    comments = (
        db.query(CollectedComment)
        .filter(
            CollectedComment.job_id == job_id,
            CollectedComment.post_reddit_id == post_reddit_id,
        )
        .order_by(CollectedComment.created_utc.asc())
        .all()
    )

    return templates.TemplateResponse(
        "partials/comment_tree.html",
        _harvest_context(
            request,
            comments=comments,
            post_reddit_id=post_reddit_id,
            job_id=job_id,
        ),
    )


@router.get("/harvest/{job_id}/charts/timeline")
async def harvest_timeline_chart(
    job_id: int,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return JSON data for the posts-per-day timeline bar chart.

    Groups posts by date and returns labels + counts for Chart.js.

    Args:
        job_id: The collection job ID.
        db: Database session.

    Returns:
        JSON with labels (dates) and data (counts).
    """
    posts = (
        db.query(CollectedPost)
        .filter(CollectedPost.job_id == job_id)
        .order_by(CollectedPost.created_utc.asc())
        .all()
    )

    if not posts:
        return JSONResponse({"labels": [], "data": []})

    # Group by date
    date_counts: Counter[str] = Counter()
    for post in posts:
        try:
            dt = datetime.fromtimestamp(post.created_utc, tz=timezone.utc)
            date_key = dt.strftime("%Y-%m-%d")
            date_counts[date_key] += 1
        except (ValueError, OSError):
            continue

    # Sort by date
    sorted_dates = sorted(date_counts.keys())
    labels = sorted_dates
    data = [date_counts[d] for d in sorted_dates]

    return JSONResponse({"labels": labels, "data": data})


@router.get("/harvest/{job_id}/charts/scores")
async def harvest_scores_chart(
    job_id: int,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return JSON data for the score distribution doughnut chart.

    Groups posts into score buckets: 0-10, 11-100, 101-1000, 1000+.

    Args:
        job_id: The collection job ID.
        db: Database session.

    Returns:
        JSON with labels (buckets) and data (counts).
    """
    posts = (
        db.query(CollectedPost)
        .filter(CollectedPost.job_id == job_id)
        .all()
    )

    if not posts:
        return JSONResponse({"labels": [], "data": []})

    buckets = {"0-10": 0, "11-100": 0, "101-1K": 0, "1K+": 0}

    for post in posts:
        score = post.score
        if score <= 10:
            buckets["0-10"] += 1
        elif score <= 100:
            buckets["11-100"] += 1
        elif score <= 1000:
            buckets["101-1K"] += 1
        else:
            buckets["1K+"] += 1

    labels = list(buckets.keys())
    data = list(buckets.values())

    return JSONResponse({"labels": labels, "data": data})


# ---------------------------------------------------------------------------
# Glean — Export API Endpoints
# ---------------------------------------------------------------------------


def _glean_context(request: Request, **kwargs: object) -> dict:
    """Build a template context dict for Glean partials.

    Args:
        request: FastAPI request object.
        **kwargs: Additional context variables.

    Returns:
        Context dictionary for Jinja2 rendering.
    """
    ctx: dict = {
        "request": request,
        "format_timestamp": _format_timestamp,
        "format_datetime": _format_datetime,
    }
    ctx.update(kwargs)
    return ctx


def _format_file_size(size_bytes: int) -> str:
    """Format a file size in bytes to a human-readable string.

    Args:
        size_bytes: File size in bytes.

    Returns:
        Human-readable string like '2.4 KB' or '1.1 MB'.
    """
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


@router.get("/glean/preview", response_class=HTMLResponse)
async def glean_preview(
    request: Request,
    job_id: int = Query(..., description="Collection job ID to preview"),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Preview what will be exported for a given collection job.

    Returns an HTML partial showing post/comment counts, date range,
    and subreddit info for the selected job.

    Args:
        request: FastAPI request.
        job_id: The collection job to preview.
        db: Database session.
    """
    templates = request.app.state.templates

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return templates.TemplateResponse(
            "partials/error_message.html",
            _glean_context(
                request,
                title="Job Not Found",
                message=f"Collection job {job_id} does not exist.",
            ),
        )

    # Count posts and comments
    post_count = (
        db.query(CollectedPost)
        .filter(CollectedPost.job_id == job_id)
        .count()
    )
    comment_count = (
        db.query(CollectedComment)
        .filter(CollectedComment.job_id == job_id)
        .count()
    )

    # Date range of posts
    posts = (
        db.query(CollectedPost)
        .filter(CollectedPost.job_id == job_id)
        .all()
    )
    date_range_start = None
    date_range_end = None
    if posts:
        timestamps = [p.created_utc for p in posts]
        date_range_start = _format_timestamp(min(timestamps))
        date_range_end = _format_timestamp(max(timestamps))

    # Unique authors
    unique_authors = len(set(p.author for p in posts if p.author != "[deleted]"))

    return templates.TemplateResponse(
        "partials/export_preview.html",
        _glean_context(
            request,
            job=job,
            post_count=post_count,
            comment_count=comment_count,
            date_range_start=date_range_start or "N/A",
            date_range_end=date_range_end or "N/A",
            unique_authors=unique_authors,
        ),
    )


@router.post("/glean/export", response_class=HTMLResponse)
async def glean_export(
    request: Request,
    db: Session = Depends(get_db),
    job_id: int = Form(...),
    format: str = Form("csv"),
    include_comments: bool = Form(False),
    anonymize: bool = Form(True),
) -> HTMLResponse:
    """Run an export for a collection job.

    Accepts form data, builds the export bundle (data + provenance),
    and returns a success partial with a download link.

    Args:
        request: FastAPI request.
        db: Database session.
        job_id: ID of the collection job to export.
        format: Export format (csv, json, jsonl).
        include_comments: Whether to include comments in the export.
        anonymize: Whether to anonymize author usernames.
    """
    from app.services.exporter import ExportService
    from app.models.schemas import ExportConfig

    templates = request.app.state.templates

    # Validate format
    valid_formats = ("csv", "json", "jsonl")
    if format not in valid_formats:
        return templates.TemplateResponse(
            "partials/export_result.html",
            _glean_context(
                request,
                success=False,
                error_message=f"Invalid format: {format}. Choose csv, json, or jsonl.",
            ),
        )

    # Build config
    config = ExportConfig(
        format=format,
        include_comments=include_comments,
        anonymize_authors=anonymize,
    )

    try:
        service = ExportService(db_session=db)
        zip_path = service.export_job(job_id=job_id, config=config)

        # Get the export record we just created
        export_record = (
            db.query(ExportRecord)
            .filter(ExportRecord.job_id == job_id)
            .order_by(ExportRecord.exported_at.desc())
            .first()
        )

        # Get file size
        file_size = zip_path.stat().st_size
        file_size_str = _format_file_size(file_size)

        # Get the job for context
        job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()

        return templates.TemplateResponse(
            "partials/export_result.html",
            _glean_context(
                request,
                success=True,
                export_record=export_record,
                job=job,
                file_size=file_size_str,
                zip_filename=zip_path.name,
                format_display=format,
            ),
        )

    except ValueError as e:
        logger.warning(f"Export validation error: {e}")
        return templates.TemplateResponse(
            "partials/export_result.html",
            _glean_context(
                request,
                success=False,
                error_message=str(e),
            ),
        )
    except Exception as e:
        logger.error(f"Export failed: {e}")
        return templates.TemplateResponse(
            "partials/export_result.html",
            _glean_context(
                request,
                success=False,
                error_message="An unexpected error occurred during export. Please try again.",
            ),
        )


@router.get("/glean/download/{export_id}")
async def glean_download(
    export_id: int,
    db: Session = Depends(get_db),
):
    """Download a previously generated export ZIP file.

    Args:
        export_id: The ExportRecord primary key.
        db: Database session.

    Returns:
        FileResponse streaming the ZIP file, or a JSON error.
    """
    from app.services.exporter import ExportService
    from fastapi.responses import FileResponse

    service = ExportService(db_session=db)
    path = service.get_export_path(export_id)

    if path is None:
        return JSONResponse(
            status_code=404,
            content={"error": "Export file not found. It may have been deleted."},
        )

    return FileResponse(
        path=str(path),
        media_type="application/zip",
        filename=path.name,
    )


@router.get("/glean/exports", response_class=HTMLResponse)
async def glean_exports_list(
    request: Request,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """List previous exports as an HTML partial table.

    Args:
        request: FastAPI request.
        db: Database session.
    """
    from app.services.exporter import ExportService

    templates = request.app.state.templates

    service = ExportService(db_session=db)
    exports = service.get_exports()

    # Build job lookup for display
    export_jobs: dict[int, CollectionJob] = {}
    for export in exports:
        if export.job_id not in export_jobs:
            job = db.query(CollectionJob).filter(CollectionJob.id == export.job_id).first()
            if job:
                export_jobs[export.job_id] = job

    return templates.TemplateResponse(
        "partials/export_list.html",
        _glean_context(
            request,
            exports=exports,
            export_jobs=export_jobs,
            format_file_size=_format_file_size,
        ),
    )


# ---------------------------------------------------------------------------
# Dashboard — Floor API Endpoints
# ---------------------------------------------------------------------------


@router.get("/dashboard/recent-jobs", response_class=HTMLResponse)
async def dashboard_recent_jobs(
    request: Request,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Get recent collection jobs as an HTML partial for the dashboard.

    Returns the last 5 collection jobs in a table format suitable
    for HTMX swap into the dashboard Recent Collections section.

    Args:
        request: FastAPI request.
        db: Database session.
    """
    templates = request.app.state.templates

    recent_jobs = (
        db.query(CollectionJob)
        .order_by(CollectionJob.id.desc())
        .limit(5)
        .all()
    )

    return templates.TemplateResponse(
        "partials/dashboard_recent_jobs.html",
        {"request": request, "recent_jobs": recent_jobs},
    )


@router.get("/dashboard/recent-exports", response_class=HTMLResponse)
async def dashboard_recent_exports(
    request: Request,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Get recent exports as an HTML partial for the dashboard.

    Returns the last 5 export records in a table format suitable
    for HTMX swap into the dashboard Recent Exports section.

    Args:
        request: FastAPI request.
        db: Database session.
    """
    templates = request.app.state.templates

    recent_exports = (
        db.query(ExportRecord)
        .order_by(ExportRecord.exported_at.desc())
        .limit(5)
        .all()
    )

    # Build job lookup
    export_jobs: dict[int, CollectionJob] = {}
    for export in recent_exports:
        if export.job_id not in export_jobs:
            job = db.query(CollectionJob).filter(CollectionJob.id == export.job_id).first()
            if job:
                export_jobs[export.job_id] = job

    return templates.TemplateResponse(
        "partials/dashboard_recent_exports.html",
        {
            "request": request,
            "recent_exports": recent_exports,
            "export_jobs": export_jobs,
        },
    )


# ---------------------------------------------------------------------------
# Saved Queries API Endpoints
# ---------------------------------------------------------------------------


@router.post("/queries/save", response_class=HTMLResponse)
async def save_query(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    description: str = Form(""),
    subreddit: str = Form(...),
    sort: str = Form("hot"),
    time_filter: str = Form("all"),
    limit: int = Form(100),
    query: Optional[str] = Form(None),
    include_comments: bool = Form(False),
    comment_depth: int = Form(0),
) -> HTMLResponse:
    """Save a collection configuration as a named query.

    Creates a SavedQuery record in the database with the provided
    collection parameters. Returns an HTML partial confirming the save.

    Args:
        request: FastAPI request.
        db: Database session.
        name: Human-readable name for the saved query.
        description: Optional description of the query's purpose.
        subreddit: Target subreddit name.
        sort: Sort method (hot/new/top/rising/controversial).
        time_filter: Time filter for top/controversial.
        limit: Maximum posts to collect.
        query: Optional keyword search.
        include_comments: Whether to collect comments.
        comment_depth: Comment tree expansion depth.
    """
    # Clean subreddit name
    subreddit_clean = subreddit.strip()
    if subreddit_clean.startswith("r/"):
        subreddit_clean = subreddit_clean[2:]
    subreddit_clean = subreddit_clean.strip("/").strip()

    if not name.strip():
        return HTMLResponse(
            '<div class="p-3 rounded" style="background: rgba(196, 75, 75, 0.1); '
            'border-left: 3px solid var(--error);">'
            '<p class="text-error text-sm mb-0">Please provide a name for this query.</p>'
            '</div>'
        )

    if not subreddit_clean:
        return HTMLResponse(
            '<div class="p-3 rounded" style="background: rgba(196, 75, 75, 0.1); '
            'border-left: 3px solid var(--error);">'
            '<p class="text-error text-sm mb-0">Please provide a subreddit name.</p>'
            '</div>'
        )

    # Clamp values
    limit = max(1, min(limit, 1000))
    comment_depth = max(0, min(comment_depth, 10))

    saved_query = SavedQuery(
        name=name.strip(),
        description=description.strip() if description else "",
        subreddit=subreddit_clean,
        sort=sort,
        time_filter=time_filter,
        limit=limit,
        query=query.strip() if query and query.strip() else "",
        include_comments=include_comments,
        comment_depth=comment_depth,
    )
    db.add(saved_query)
    db.commit()
    db.refresh(saved_query)

    logger.info(f"Saved query '{saved_query.name}' (id={saved_query.id}) for r/{subreddit_clean}")

    return HTMLResponse(
        '<div class="p-3 rounded" style="background: rgba(74, 155, 110, 0.1); '
        'border-left: 3px solid var(--success);">'
        '<div class="flex items-center gap-2">'
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" '
        'fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>'
        '<polyline points="22 4 12 14.01 9 11.01"/></svg>'
        f'<p class="text-success text-sm mb-0">Query &ldquo;{saved_query.name}&rdquo; saved successfully.</p>'
        '</div></div>'
    )


@router.get("/queries", response_class=HTMLResponse)
async def list_queries(
    request: Request,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """List all saved queries as HTML partials.

    Returns saved query cards for HTMX swap into the dashboard
    or any other listing context.

    Args:
        request: FastAPI request.
        db: Database session.
    """
    templates = request.app.state.templates

    saved_queries = (
        db.query(SavedQuery)
        .order_by(SavedQuery.created_at.desc())
        .all()
    )

    return templates.TemplateResponse(
        "partials/saved_queries_list.html",
        {"request": request, "saved_queries": saved_queries},
    )


@router.delete("/queries/{query_id}", response_class=HTMLResponse)
async def delete_query(
    request: Request,
    query_id: int,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Delete a saved query by ID.

    Removes the SavedQuery record from the database. Returns an
    empty string so the HTMX outerHTML swap removes the card.

    Args:
        request: FastAPI request.
        query_id: The SavedQuery primary key.
        db: Database session.
    """
    saved_query = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()

    if saved_query is None:
        return HTMLResponse(
            '<div class="p-3 rounded" style="background: rgba(196, 75, 75, 0.1); '
            'border-left: 3px solid var(--error);">'
            f'<p class="text-error text-sm mb-0">Query {query_id} not found.</p>'
            '</div>'
        )

    name = saved_query.name
    db.delete(saved_query)
    db.commit()

    logger.info(f"Deleted saved query '{name}' (id={query_id})")

    # Return empty string — HTMX outerHTML swap removes the card
    return HTMLResponse("")


@router.post("/queries/{query_id}/run", response_class=HTMLResponse)
async def run_saved_query(
    request: Request,
    query_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """Re-run a saved query by creating a new collection job.

    Loads the SavedQuery configuration, creates a new CollectionJob,
    and starts a background collection task. Returns a confirmation
    partial that replaces the saved query card temporarily.

    Args:
        request: FastAPI request.
        query_id: The SavedQuery primary key.
        background_tasks: FastAPI background task runner.
        db: Database session.
    """
    saved_query = db.query(SavedQuery).filter(SavedQuery.id == query_id).first()

    if saved_query is None:
        return HTMLResponse(
            '<div class="p-3 rounded" style="background: rgba(196, 75, 75, 0.1); '
            'border-left: 3px solid var(--error);">'
            f'<p class="text-error text-sm mb-0">Saved query {query_id} not found.</p>'
            '</div>'
        )

    # Build collection config from saved query
    config = CollectionConfig(
        subreddit=saved_query.subreddit,
        sort=saved_query.sort,
        time_filter=saved_query.time_filter,
        limit=saved_query.limit,
        query=saved_query.query if saved_query.query else None,
        include_comments=saved_query.include_comments,
        comment_depth=saved_query.comment_depth,
    )

    # Create a pending job record linked to this saved query
    job = CollectionJob(
        saved_query_id=saved_query.id,
        subreddit=config.subreddit,
        status="pending",
        total_posts=config.limit,
        collected_posts=0,
        total_comments=0,
        collected_comments=0,
    )
    db.add(job)

    # Update last_run_at
    saved_query.last_run_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(job)
    db.refresh(saved_query)

    logger.info(
        f"Re-running saved query '{saved_query.name}' (id={query_id}) "
        f"as job {job.id}"
    )

    # Schedule background collection
    background_tasks.add_task(
        _run_collection_background,
        config=config,
        job_id=job.id,
    )

    # Return a confirmation that replaces the card
    return HTMLResponse(
        f'<div class="saved-query-card" id="saved-query-{saved_query.id}">'
        f'<div class="p-3 rounded" style="background: rgba(74, 155, 110, 0.1); '
        f'border-left: 3px solid var(--success);">'
        f'<div class="flex items-center gap-2 mb-2">'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" '
        f'fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" '
        f'stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>'
        f'<polyline points="22 4 12 14.01 9 11.01"/></svg>'
        f'<p class="text-success text-sm mb-0">Collection started for r/{saved_query.subreddit}</p>'
        f'</div>'
        f'<p class="text-xs text-ash mb-0">Job #{job.id} is running. '
        f'<a href="/thresh" class="text-link">View progress</a></p>'
        f'</div></div>'
    )


# ---------------------------------------------------------------------------
# Export Download (alias for dashboard use)
# ---------------------------------------------------------------------------

@router.get("/exports/{export_id}/download")
async def export_download(
    export_id: int,
    db: Session = Depends(get_db),
):
    """Download an export file by export record ID.

    An alias for the Glean download endpoint, usable from the dashboard.

    Args:
        export_id: The ExportRecord primary key.
        db: Database session.

    Returns:
        FileResponse streaming the ZIP file, or a JSON error.
    """
    from app.services.exporter import ExportService
    from fastapi.responses import FileResponse

    service = ExportService(db_session=db)
    path = service.get_export_path(export_id)

    if path is None:
        return JSONResponse(
            status_code=404,
            content={"error": "Export file not found. It may have been deleted."},
        )

    return FileResponse(
        path=str(path),
        media_type="application/zip",
        filename=path.name,
    )


# ---------------------------------------------------------------------------
# Winnow — Analysis API Endpoints
# ---------------------------------------------------------------------------


@router.get("/winnow/{job_id}/word-frequency")
async def winnow_word_frequency(
    job_id: int,
    top_n: int = Query(50, ge=1, le=200, description="Number of top words"),
    include_comments: bool = Query(True, description="Include comment text"),
    min_length: int = Query(3, ge=2, le=10, description="Minimum word length"),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return top word frequencies for a collection job.

    Args:
        job_id: The collection job ID.
        top_n: Number of top words to return.
        include_comments: Whether to include comment text.
        min_length: Minimum word length.
        db: Database session.

    Returns:
        JSON with ``words`` (list of word strings) and ``counts`` (list of ints).
    """
    from app.services.analyzer import AnalyzerService

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Collection job {job_id} not found."},
        )

    try:
        analyzer = AnalyzerService(db_session=db)
        freq = analyzer.get_word_frequencies(
            job_id=job_id,
            top_n=top_n,
            include_comments=include_comments,
            min_word_length=min_length,
        )
        words = [w for w, _ in freq]
        counts = [c for _, c in freq]
        return JSONResponse({"words": words, "counts": counts})
    except Exception as e:
        logger.error(f"Winnow word frequency error for job {job_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to compute word frequencies."},
        )


@router.get("/winnow/{job_id}/bigrams")
async def winnow_bigrams(
    job_id: int,
    top_n: int = Query(30, ge=1, le=100, description="Number of top bigrams"),
    include_comments: bool = Query(True, description="Include comment text"),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return top bigram frequencies for a collection job.

    Args:
        job_id: The collection job ID.
        top_n: Number of top bigrams to return.
        include_comments: Whether to include comment text.
        db: Database session.

    Returns:
        JSON with ``bigrams`` (list of phrase strings) and ``counts`` (list of ints).
    """
    from app.services.analyzer import AnalyzerService

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Collection job {job_id} not found."},
        )

    try:
        analyzer = AnalyzerService(db_session=db)
        freq = analyzer.get_bigram_frequencies(
            job_id=job_id,
            top_n=top_n,
            include_comments=include_comments,
        )
        bigrams = [b for b, _ in freq]
        counts = [c for _, c in freq]
        return JSONResponse({"bigrams": bigrams, "counts": counts})
    except Exception as e:
        logger.error(f"Winnow bigrams error for job {job_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to compute bigram frequencies."},
        )


@router.get("/winnow/{job_id}/temporal")
async def winnow_temporal(
    job_id: int,
    interval: str = Query("day", description="Interval: hour, day, week, month"),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return temporal post distribution for a collection job.

    Args:
        job_id: The collection job ID.
        interval: Time interval for grouping.
        db: Database session.

    Returns:
        JSON with ``dates`` (list of date strings) and ``counts`` (list of ints).
    """
    from app.services.analyzer import AnalyzerService

    # Validate interval
    valid_intervals = ("hour", "day", "week", "month")
    if interval not in valid_intervals:
        interval = "day"

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Collection job {job_id} not found."},
        )

    try:
        analyzer = AnalyzerService(db_session=db)
        dist = analyzer.get_temporal_distribution(job_id=job_id, interval=interval)
        dates = [d["date"] for d in dist]
        counts = [d["count"] for d in dist]
        return JSONResponse({"dates": dates, "counts": counts})
    except Exception as e:
        logger.error(f"Winnow temporal error for job {job_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to compute temporal distribution."},
        )


@router.get("/winnow/{job_id}/keywords")
async def winnow_keywords(
    job_id: int,
    keywords: str = Query("", description="Comma-separated keywords"),
    interval: str = Query("day", description="Interval: hour, day, week, month"),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return keyword trend data for a collection job.

    Args:
        job_id: The collection job ID.
        keywords: Comma-separated list of keywords to track.
        interval: Time interval for grouping.
        db: Database session.

    Returns:
        JSON with ``trends`` mapping keyword to list of
        ``{date, count}`` dicts.
    """
    from app.services.analyzer import AnalyzerService

    valid_intervals = ("hour", "day", "week", "month")
    if interval not in valid_intervals:
        interval = "day"

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Collection job {job_id} not found."},
        )

    # Parse keywords
    kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
    if not kw_list:
        return JSONResponse({"trends": {}})

    try:
        analyzer = AnalyzerService(db_session=db)
        trends = analyzer.get_keyword_trends(
            job_id=job_id,
            keywords=kw_list,
            interval=interval,
        )
        return JSONResponse({"trends": trends})
    except Exception as e:
        logger.error(f"Winnow keywords error for job {job_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to compute keyword trends."},
        )


@router.get("/winnow/{job_id}/authors")
async def winnow_authors(
    job_id: int,
    top_n: int = Query(20, ge=1, le=100, description="Number of top authors"),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return top author statistics for a collection job.

    Args:
        job_id: The collection job ID.
        top_n: Number of top authors.
        db: Database session.

    Returns:
        JSON with ``authors`` list of author stat dicts.
    """
    from app.services.analyzer import AnalyzerService

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Collection job {job_id} not found."},
        )

    try:
        analyzer = AnalyzerService(db_session=db)
        authors = analyzer.get_author_stats(job_id=job_id, top_n=top_n)
        return JSONResponse({"authors": authors})
    except Exception as e:
        logger.error(f"Winnow authors error for job {job_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to compute author statistics."},
        )


@router.get("/winnow/{job_id}/engagement")
async def winnow_engagement(
    job_id: int,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Return overall engagement statistics for a collection job.

    Args:
        job_id: The collection job ID.
        db: Database session.

    Returns:
        JSON with engagement stats dict.
    """
    from app.services.analyzer import AnalyzerService

    job = db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"error": f"Collection job {job_id} not found."},
        )

    try:
        analyzer = AnalyzerService(db_session=db)
        stats = analyzer.get_engagement_stats(job_id=job_id)
        # Also fetch score distribution for histogram
        histogram = analyzer.get_score_distribution(job_id=job_id, bins=20)
        stats["score_histogram"] = histogram
        return JSONResponse(stats)
    except Exception as e:
        logger.error(f"Winnow engagement error for job {job_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to compute engagement statistics."},
        )
