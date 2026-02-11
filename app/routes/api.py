"""API routes — HTML partial endpoints for HTMX and programmatic access."""

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import praw
import prawcore
from fastapi import APIRouter, BackgroundTasks, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models.database import SessionLocal, get_db
from app.models.schemas import CollectionConfig
from app.models.tables import CollectedComment, CollectedPost, CollectionJob
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
    except prawcore.exceptions.ResponseException as e:
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

    if client._client is None:
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Reddit API Not Configured",
                message=(
                    "Reddit API credentials are not set up yet. "
                    "You need to configure your Client ID, Client Secret, "
                    "and User Agent before you can search subreddits."
                ),
                show_setup_link=True,
            ),
        )

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

    if client._client is None:
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Reddit API Not Configured",
                message=(
                    "Reddit API credentials are not set up yet. "
                    "Configure them on the About page to preview subreddits."
                ),
                show_setup_link=True,
            ),
        )

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

    if client._client is None:
        return templates.TemplateResponse(
            "partials/error_message.html",
            _explore_context(
                request,
                title="Reddit API Not Configured",
                message="Configure your Reddit API credentials to preview posts.",
                show_setup_link=True,
            ),
        )

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
