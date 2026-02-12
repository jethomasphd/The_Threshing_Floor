"""Reddit data collection via public JSON endpoints — no API key required.

Fetches structured JSON from reddit.com by appending .json to any URL.
Returns the same Pydantic models as RedditClient so the rest of the app
needs zero changes. Rate-limited to be polite (2 seconds between requests).
"""

import logging
import time
from typing import Optional

import httpx

from app.models.schemas import (
    CommentData,
    PostData,
    RateLimitInfo,
    SubredditInfo,
)
from app.services.cache import Cache

logger = logging.getLogger(__name__)

# Reddit public JSON endpoints
_BASE_URL = "https://www.reddit.com"
_HEADERS = {
    "User-Agent": (
        "Thresh:v0.1.0 (research tool; "
        "+https://github.com/jethomasphd/The_Threshing_Floor)"
    ),
    "Accept": "application/json",
}

# Rate limiting — be polite to Reddit's public endpoints
_MIN_REQUEST_INTERVAL = 2.0  # seconds between requests
_MAX_RETRIES = 3
_TIMEOUT = 30.0

# Same caps as RedditClient
_MAX_SUBREDDIT_SEARCH = 25
_MAX_POSTS = 250
_MAX_COMMENTS = 500
_CACHE_TTL = 900  # 15 minutes


class RedditScraper:
    """Collects Reddit data from public JSON endpoints without API credentials.

    Drop-in replacement for RedditClient. Same method signatures, same
    Pydantic models returned. The rest of the application never knows
    the difference.
    """

    def __init__(self) -> None:
        """Initialize the scraper with an httpx client and rate limiter."""
        self._last_request_time: float = 0.0
        self._request_count: int = 0
        self._session_start: float = time.time()
        self._cache = Cache()
        self._http = httpx.Client(
            headers=_HEADERS,
            timeout=_TIMEOUT,
            follow_redirects=True,
        )

    def _rate_limit_wait(self) -> None:
        """Enforce polite rate limiting between requests."""
        elapsed = time.time() - self._last_request_time
        if elapsed < _MIN_REQUEST_INTERVAL:
            time.sleep(_MIN_REQUEST_INTERVAL - elapsed)

    def _get_json(self, url: str, params: dict | None = None) -> dict | list:
        """Fetch JSON from Reddit with rate limiting and retries.

        Args:
            url: The Reddit URL (should end with .json).
            params: Optional query parameters.

        Returns:
            Parsed JSON response (dict or list).

        Raises:
            ValueError: If 404 (not found).
            ConnectionError: If network/auth/rate-limit issues.
            RuntimeError: If all retries exhausted.
        """
        self._rate_limit_wait()

        for attempt in range(_MAX_RETRIES):
            try:
                self._last_request_time = time.time()
                self._request_count += 1
                response = self._http.get(url, params=params)

                if response.status_code == 429:
                    wait = min(2 ** (attempt + 2), 30)
                    logger.warning(
                        f"Rate limited by Reddit. Waiting {wait}s (attempt {attempt + 1})"
                    )
                    time.sleep(wait)
                    continue

                if response.status_code == 403:
                    raise ConnectionError(
                        "Reddit returned 403 Forbidden. The subreddit may be "
                        "private, quarantined, or Reddit is temporarily "
                        "blocking requests. Try again in a moment."
                    )

                if response.status_code == 404:
                    raise ValueError("Subreddit or resource not found.")

                response.raise_for_status()
                return response.json()

            except httpx.TimeoutException:
                if attempt < _MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise ConnectionError(
                    "Reddit is not responding. Please try again in a moment."
                )
            except (ValueError, ConnectionError):
                raise
            except httpx.HTTPStatusError as e:
                raise ConnectionError(
                    f"Reddit returned an error (HTTP {e.response.status_code}). "
                    "Please try again."
                )
            except httpx.HTTPError:
                if attempt < _MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise ConnectionError(
                    "Could not reach Reddit. Check your internet connection."
                )

        raise RuntimeError("Failed to fetch data from Reddit after retries.")

    # ------------------------------------------------------------------
    # Public interface — same method signatures as RedditClient
    # ------------------------------------------------------------------

    def is_authenticated(self) -> bool:
        """Web scraper is always ready — no credentials needed.

        Returns:
            Always True.
        """
        return True

    def search_subreddits(
        self, query: str, limit: int = 10
    ) -> list[SubredditInfo]:
        """Search for subreddits matching a query.

        Args:
            query: Search term.
            limit: Maximum results (capped at _MAX_SUBREDDIT_SEARCH).

        Returns:
            List of SubredditInfo models.
        """
        limit = min(limit, _MAX_SUBREDDIT_SEARCH)
        url = f"{_BASE_URL}/subreddits/search.json"
        params = {"q": query, "limit": limit, "type": "sr"}

        try:
            data = self._get_json(url, params)
            results: list[SubredditInfo] = []
            for child in data.get("data", {}).get("children", []):
                sr = child.get("data", {})
                results.append(SubredditInfo(
                    name=sr.get("display_name", ""),
                    title=sr.get("title", ""),
                    subscribers=sr.get("subscribers", 0) or 0,
                    description=sr.get("public_description", ""),
                    created_utc=sr.get("created_utc", 0.0),
                ))
            return results
        except (ValueError, ConnectionError):
            raise
        except Exception as e:
            logger.error(f"Error searching subreddits: {e}")
            raise RuntimeError(f"Failed to search subreddits: {e}")

    def get_subreddit_meta(self, name: str) -> SubredditInfo:
        """Get metadata for a specific subreddit.

        Results are cached with a 15-minute TTL.

        Args:
            name: Subreddit display name (without r/ prefix).

        Returns:
            SubredditInfo model.
        """
        # Check cache first
        cache_key = f"subreddit_meta:{name.lower()}"
        cached = self._cache.retrieve(cache_key)
        if cached is not None:
            logger.debug(f"Cache hit for subreddit metadata: {name}")
            return SubredditInfo.model_validate_json(cached)

        url = f"{_BASE_URL}/r/{name}/about.json"

        try:
            data = self._get_json(url)
            sr = data.get("data", {})
            info = SubredditInfo(
                name=sr.get("display_name", name),
                title=sr.get("title", ""),
                subscribers=sr.get("subscribers", 0) or 0,
                description=sr.get("public_description", ""),
                created_utc=sr.get("created_utc", 0.0),
            )
            # Cache the result
            self._cache.store(cache_key, info.model_dump_json(), _CACHE_TTL)
            return info
        except (ValueError, ConnectionError):
            raise
        except Exception as e:
            logger.error(f"Error getting subreddit metadata: {e}")
            raise RuntimeError(f"Failed to get subreddit info: {e}")

    def get_posts(
        self,
        subreddit: str,
        sort: str = "hot",
        time_filter: str = "all",
        limit: int = 25,
        query: Optional[str] = None,
    ) -> list[PostData]:
        """Get posts from a subreddit.

        Handles pagination via Reddit's 'after' parameter to fetch
        more than 100 posts when requested.

        Args:
            subreddit: Subreddit display name.
            sort: Sort method (hot/new/top/rising/controversial).
            time_filter: Time filter for top/controversial.
            limit: Maximum posts (capped at _MAX_POSTS).
            query: Optional search query within the subreddit.

        Returns:
            List of PostData models.
        """
        limit = min(limit, _MAX_POSTS)
        posts: list[PostData] = []
        after: str | None = None
        per_page = min(limit, 100)  # Reddit caps at 100 per request

        try:
            while len(posts) < limit:
                remaining = limit - len(posts)
                batch_size = min(remaining, per_page)

                if query:
                    url = f"{_BASE_URL}/r/{subreddit}/search.json"
                    params: dict = {
                        "q": query,
                        "restrict_sr": "on",
                        "sort": sort if sort in (
                            "relevance", "hot", "top", "new", "comments"
                        ) else "relevance",
                        "t": time_filter,
                        "limit": batch_size,
                    }
                else:
                    url = f"{_BASE_URL}/r/{subreddit}/{sort}.json"
                    params = {"limit": batch_size}
                    if sort in ("top", "controversial"):
                        params["t"] = time_filter

                if after:
                    params["after"] = after

                data = self._get_json(url, params)
                children = data.get("data", {}).get("children", [])

                if not children:
                    break

                for child in children:
                    post = child.get("data", {})
                    posts.append(PostData(
                        id=post.get("id", ""),
                        subreddit=post.get("subreddit", subreddit),
                        title=post.get("title", ""),
                        selftext=post.get("selftext", ""),
                        author=post.get("author", "[deleted]"),
                        score=post.get("score", 0),
                        num_comments=post.get("num_comments", 0),
                        created_utc=post.get("created_utc", 0.0),
                        url=post.get("url", ""),
                        permalink=post.get("permalink", ""),
                    ))

                after = data.get("data", {}).get("after")
                if not after:
                    break

            return posts[:limit]

        except (ValueError, ConnectionError):
            raise
        except Exception as e:
            logger.error(f"Error getting posts: {e}")
            raise RuntimeError(f"Failed to get posts: {e}")

    def get_comments(
        self,
        post_id: str,
        depth: int = 3,
        limit: int = 100,
    ) -> list[CommentData]:
        """Get comments for a post, flattened from the nested tree.

        Args:
            post_id: Reddit submission ID.
            depth: Maximum depth of comment nesting to retrieve.
            limit: Maximum comments to return (capped at _MAX_COMMENTS).

        Returns:
            List of CommentData models in flattened order.
        """
        limit = min(limit, _MAX_COMMENTS)
        url = f"{_BASE_URL}/comments/{post_id}.json"
        params = {"depth": depth, "limit": limit, "sort": "confidence"}

        try:
            data = self._get_json(url, params)

            if not isinstance(data, list) or len(data) < 2:
                return []

            comments: list[CommentData] = []
            self._extract_comments(data[1], post_id, comments, limit)
            return comments

        except (ValueError, ConnectionError):
            raise
        except Exception as e:
            logger.error(f"Error getting comments: {e}")
            raise RuntimeError(f"Failed to get comments: {e}")

    def _extract_comments(
        self,
        listing: dict,
        post_id: str,
        comments: list[CommentData],
        limit: int,
    ) -> None:
        """Recursively extract comments from Reddit's nested JSON structure.

        Args:
            listing: A Reddit Listing JSON object.
            post_id: The parent post ID.
            comments: Mutable list to append results to.
            limit: Maximum comments to collect.
        """
        children = listing.get("data", {}).get("children", [])

        for child in children:
            if len(comments) >= limit:
                break

            if child.get("kind") != "t1":
                continue

            cdata = child.get("data", {})
            comments.append(CommentData(
                id=cdata.get("id", ""),
                post_id=post_id,
                parent_id=cdata.get("parent_id", ""),
                author=cdata.get("author", "[deleted]"),
                body=cdata.get("body", ""),
                score=cdata.get("score", 0),
                created_utc=cdata.get("created_utc", 0.0),
                depth=cdata.get("depth", 0),
            ))

            # Recurse into nested replies
            replies = cdata.get("replies")
            if isinstance(replies, dict) and len(comments) < limit:
                self._extract_comments(replies, post_id, comments, limit)

    def get_rate_limit_status(self) -> RateLimitInfo:
        """Return estimated rate limit status for polite scraping.

        Public endpoints allow roughly 30 requests per minute for
        unauthenticated access. We track our own usage.

        Returns:
            RateLimitInfo with estimated remaining quota.
        """
        elapsed = time.time() - self._session_start
        # Reset counter every 60 seconds
        if elapsed >= 60:
            self._request_count = 0
            self._session_start = time.time()

        return RateLimitInfo(
            remaining=max(0.0, 30.0 - self._request_count),
            used=self._request_count,
            reset_timestamp=self._session_start + 60,
        )

    def validate_credentials(self) -> tuple[bool, str]:
        """No credentials to validate — always ready.

        Returns:
            Tuple of (True, success message).
        """
        return (True, "No credentials needed — using public web access.")

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._http.close()
