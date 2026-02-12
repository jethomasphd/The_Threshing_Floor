"""Reddit data access layer for The Threshing Floor.

Default mode: public JSON endpoints via RedditScraper (no credentials needed).
Optional upgrade: PRAW with API credentials (higher rate limits, authenticated).

The factory function get_reddit_client() returns whichever backend is
appropriate. Both expose the same interface — the rest of the app never
knows the difference.
"""

import logging
import time
from typing import Optional, Union

from app.config import Settings, get_settings
from app.models.schemas import (
    CommentData,
    PostData,
    RateLimitInfo,
    SubredditInfo,
)
from app.services.cache import Cache
from app.services.web_scraper import RedditScraper

logger = logging.getLogger(__name__)

# Sensible upper bounds to prevent unbounded API calls
_MAX_SUBREDDIT_SEARCH = 25
_MAX_POSTS = 250
_MAX_COMMENTS = 500
_REPLACE_MORE_LIMIT = 10
_CACHE_TTL = 900  # 15 minutes


class RedditClient:
    """PRAW wrapper that returns Pydantic models and handles errors gracefully.

    Only used when the user explicitly configures Reddit API credentials
    for higher rate limits and authenticated access.
    """

    def __init__(self, settings: Settings) -> None:
        """Initialize PRAW Reddit instance from settings.

        Args:
            settings: Application settings containing Reddit API credentials.
        """
        import praw

        self._client: Optional[praw.Reddit] = None
        self._request_count: int = 0
        self._cache = Cache()

        if (
            settings.REDDIT_CLIENT_ID
            and settings.REDDIT_CLIENT_SECRET
            and settings.REDDIT_USER_AGENT
        ):
            try:
                self._client = praw.Reddit(
                    client_id=settings.REDDIT_CLIENT_ID,
                    client_secret=settings.REDDIT_CLIENT_SECRET,
                    user_agent=settings.REDDIT_USER_AGENT,
                )
                logger.info("PRAW Reddit client initialized (authenticated mode)")
            except Exception as e:
                logger.error(f"Failed to initialize PRAW client: {e}")
                self._client = None
        else:
            logger.info(
                "No Reddit API credentials — this client should not be used. "
                "Use RedditScraper instead."
            )

    def is_authenticated(self) -> bool:
        """Check if client is set up and can reach Reddit.

        Returns:
            True if the client exists and Reddit is reachable.
        """
        if self._client is None:
            return False
        try:
            self._client.auth.scopes()
            self._request_count += 1
            return True
        except Exception:
            return False

    def search_subreddits(
        self, query: str, limit: int = 10
    ) -> list[SubredditInfo]:
        """Search for subreddits matching a query.

        Args:
            query: Search term.
            limit: Maximum number of results (capped at _MAX_SUBREDDIT_SEARCH).

        Returns:
            List of SubredditInfo models.
        """
        import praw
        import prawcore

        if self._client is None:
            return []

        limit = min(limit, _MAX_SUBREDDIT_SEARCH)

        try:
            results: list[SubredditInfo] = []
            for sub in self._client.subreddits.search(query, limit=limit):
                results.append(
                    SubredditInfo(
                        name=sub.display_name,
                        title=sub.title or "",
                        subscribers=sub.subscribers or 0,
                        description=sub.public_description or "",
                        created_utc=sub.created_utc,
                    )
                )
            self._request_count += 1
            return results
        except prawcore.exceptions.InvalidToken:
            raise ValueError("Invalid credentials. Please check your Reddit API settings.")
        except prawcore.exceptions.RequestException:
            raise ConnectionError("Could not reach Reddit. Check your internet connection.")
        except praw.exceptions.PRAWException as e:
            raise RuntimeError(f"Reddit API error: {e}")
        except Exception as e:
            raise RuntimeError(f"An unexpected error occurred: {str(e)}")

    def get_subreddit_meta(self, name: str) -> SubredditInfo:
        """Get full metadata for a single subreddit.

        Args:
            name: Subreddit display name (without r/ prefix).

        Returns:
            SubredditInfo model with subreddit metadata.
        """
        import praw
        import prawcore

        if self._client is None:
            raise RuntimeError("Reddit client not configured")

        cache_key = f"subreddit_meta:{name.lower()}"
        cached = self._cache.retrieve(cache_key)
        if cached is not None:
            return SubredditInfo.model_validate_json(cached)

        try:
            sub = self._client.subreddit(name)
            _ = sub.subscribers
            self._request_count += 1

            info = SubredditInfo(
                name=sub.display_name,
                title=sub.title or "",
                subscribers=sub.subscribers or 0,
                description=sub.public_description or "",
                created_utc=sub.created_utc,
            )
            self._cache.store(cache_key, info.model_dump_json(), _CACHE_TTL)
            return info
        except prawcore.exceptions.InvalidToken:
            raise ValueError("Invalid credentials. Please check your Reddit API settings.")
        except prawcore.exceptions.RequestException:
            raise ConnectionError("Could not reach Reddit. Check your internet connection.")
        except prawcore.exceptions.NotFound:
            raise ValueError(f"Subreddit '{name}' not found")
        except praw.exceptions.PRAWException as e:
            raise RuntimeError(f"Reddit API error: {e}")
        except Exception as e:
            raise RuntimeError(f"An unexpected error occurred: {str(e)}")

    def get_posts(
        self,
        subreddit: str,
        sort: str = "hot",
        time_filter: str = "all",
        limit: int = 25,
        query: Optional[str] = None,
    ) -> list[PostData]:
        """Get posts from a subreddit.

        Args:
            subreddit: Subreddit display name.
            sort: Sort method (hot/new/top/rising/controversial).
            time_filter: Time filter for top/controversial.
            limit: Maximum number of posts (capped at _MAX_POSTS).
            query: Optional search query within the subreddit.

        Returns:
            List of PostData models.
        """
        import praw
        import prawcore

        if self._client is None:
            return []

        limit = min(limit, _MAX_POSTS)

        try:
            sub = self._client.subreddit(subreddit)

            if query:
                submissions = sub.search(
                    query,
                    sort=sort if sort in ("relevance", "hot", "top", "new", "comments") else "relevance",
                    time_filter=time_filter,
                    limit=limit,
                )
            else:
                sort_methods = {
                    "hot": sub.hot,
                    "new": sub.new,
                    "top": sub.top,
                    "rising": sub.rising,
                    "controversial": sub.controversial,
                }
                sort_func = sort_methods.get(sort, sub.hot)

                if sort in ("top", "controversial"):
                    submissions = sort_func(time_filter=time_filter, limit=limit)
                else:
                    submissions = sort_func(limit=limit)

            results: list[PostData] = []
            for submission in submissions:
                author_name = (
                    submission.author.name if submission.author else "[deleted]"
                )
                results.append(
                    PostData(
                        id=submission.id,
                        subreddit=submission.subreddit.display_name,
                        title=submission.title,
                        selftext=submission.selftext or "",
                        author=author_name,
                        score=submission.score,
                        num_comments=submission.num_comments,
                        created_utc=submission.created_utc,
                        url=submission.url,
                        permalink=submission.permalink,
                    )
                )
            self._request_count += 1
            return results
        except prawcore.exceptions.InvalidToken:
            raise ValueError("Invalid credentials. Please check your Reddit API settings.")
        except prawcore.exceptions.RequestException:
            raise ConnectionError("Could not reach Reddit. Check your internet connection.")
        except praw.exceptions.PRAWException as e:
            raise RuntimeError(f"Reddit API error: {e}")
        except Exception as e:
            raise RuntimeError(f"An unexpected error occurred: {str(e)}")

    def get_comments(
        self,
        post_id: str,
        depth: int = 3,
        limit: int = 100,
    ) -> list[CommentData]:
        """Get comments for a post, flattened from the comment forest.

        Args:
            post_id: Reddit submission ID.
            depth: Limit for replace_more() expansion.
            limit: Maximum comments to return (capped at _MAX_COMMENTS).

        Returns:
            List of CommentData models in flattened order.
        """
        import praw
        import prawcore

        if self._client is None:
            return []

        limit = min(limit, _MAX_COMMENTS)
        replace_more_limit = min(depth, _REPLACE_MORE_LIMIT)

        try:
            submission = self._client.submission(id=post_id)
            submission.comments.replace_more(limit=replace_more_limit)
            self._request_count += 1

            results: list[CommentData] = []
            for comment in submission.comments.list():
                if len(results) >= limit:
                    break
                if not hasattr(comment, "body"):
                    continue

                author_name = (
                    comment.author.name if comment.author else "[deleted]"
                )
                results.append(
                    CommentData(
                        id=comment.id,
                        post_id=post_id,
                        parent_id=comment.parent_id,
                        author=author_name,
                        body=comment.body,
                        score=comment.score,
                        created_utc=comment.created_utc,
                        depth=comment.depth if hasattr(comment, "depth") else 0,
                    )
                )
            return results
        except prawcore.exceptions.InvalidToken:
            raise ValueError("Invalid credentials. Please check your Reddit API settings.")
        except prawcore.exceptions.RequestException:
            raise ConnectionError("Could not reach Reddit. Check your internet connection.")
        except praw.exceptions.PRAWException as e:
            raise RuntimeError(f"Reddit API error: {e}")
        except Exception as e:
            raise RuntimeError(f"An unexpected error occurred: {str(e)}")

    def get_rate_limit_status(self) -> RateLimitInfo:
        """Return current rate limit info from PRAW.

        Returns:
            RateLimitInfo model with current rate limit status.
        """
        if self._client is None:
            return RateLimitInfo(remaining=0.0, used=self._request_count, reset_timestamp=0.0)

        try:
            rate_limiter = self._client._core._rate_limiter
            remaining_val = getattr(rate_limiter, "remaining", None)
            reset_timestamp = getattr(rate_limiter, "reset_timestamp", None)
            used_val = getattr(rate_limiter, "used", None)

            return RateLimitInfo(
                remaining=float(remaining_val) if remaining_val is not None else 100.0,
                used=int(used_val) if used_val is not None else self._request_count,
                reset_timestamp=float(reset_timestamp) if reset_timestamp is not None else 0.0,
            )
        except Exception:
            return RateLimitInfo(
                remaining=100.0 - self._request_count,
                used=self._request_count,
                reset_timestamp=time.time() + 60,
            )

    def validate_credentials(self) -> tuple[bool, str]:
        """Test if Reddit API credentials work.

        Returns:
            Tuple of (success: bool, message: str).
        """
        import prawcore

        if self._client is None:
            return (False, "Reddit API credentials are not configured.")

        try:
            self._client.auth.scopes()
            self._request_count += 1
            return (True, "Reddit API credentials are valid.")
        except prawcore.exceptions.OAuthException:
            return (False, "Invalid credentials. Please check your Reddit API settings.")
        except prawcore.exceptions.ResponseException:
            return (False, "Invalid credentials. Please check your Reddit API settings.")
        except prawcore.exceptions.RequestException:
            return (False, "Could not reach Reddit. Check your internet connection.")
        except Exception as e:
            return (False, f"An unexpected error occurred: {str(e)}")


# ------------------------------------------------------------------
# Factory — returns the right backend based on configuration
# ------------------------------------------------------------------

# The client singleton — either RedditScraper (default) or RedditClient (with API keys)
_reddit_client: Optional[Union[RedditScraper, RedditClient]] = None


def get_reddit_client() -> Union[RedditScraper, RedditClient]:
    """Return a singleton data access client.

    If Reddit API credentials are configured, returns a PRAW-based
    RedditClient (higher rate limits, authenticated access). Otherwise,
    returns a RedditScraper that uses public JSON endpoints — no
    credentials required.

    Returns:
        The shared client instance.
    """
    global _reddit_client
    if _reddit_client is None:
        settings = get_settings()
        if (
            settings.REDDIT_CLIENT_ID
            and settings.REDDIT_CLIENT_SECRET
            and settings.REDDIT_USER_AGENT
        ):
            logger.info("Reddit API credentials found — using authenticated PRAW client")
            _reddit_client = RedditClient(settings)
        else:
            logger.info("No Reddit API credentials — using public web scraper (no setup needed)")
            _reddit_client = RedditScraper()
    return _reddit_client


def has_api_credentials() -> bool:
    """Check whether Reddit API credentials are configured.

    Returns:
        True if all three credential fields are set in settings.
    """
    settings = get_settings()
    return bool(
        settings.REDDIT_CLIENT_ID
        and settings.REDDIT_CLIENT_SECRET
        and settings.REDDIT_USER_AGENT
    )


def _reset_client() -> None:
    """Reset the singleton so it reinitializes on next access.

    Called after credentials are saved so the app picks up new settings.
    """
    global _reddit_client
    _reddit_client = None
    logger.info("Reddit client singleton reset — will reinitialize on next access")
