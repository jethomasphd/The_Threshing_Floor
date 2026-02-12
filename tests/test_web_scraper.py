"""Unit tests for the RedditScraper (public JSON endpoint client).

All HTTP calls are mocked — no network access required.
Tests verify that RedditScraper methods return proper Pydantic models
and handle errors gracefully.
"""

import time
from unittest.mock import MagicMock

import httpx
import pytest

from app.models.schemas import (
    CommentData,
    PostData,
    RateLimitInfo,
    SubredditInfo,
)
from app.services.web_scraper import RedditScraper


# ---------------------------------------------------------------------------
# Fixtures: mock JSON responses that mirror Reddit's public JSON structure
# ---------------------------------------------------------------------------

def _subreddit_listing_json(subreddits: list[dict]) -> dict:
    """Build a mock Reddit subreddit search JSON response."""
    return {
        "kind": "Listing",
        "data": {
            "children": [
                {
                    "kind": "t5",
                    "data": sr,
                }
                for sr in subreddits
            ],
            "after": None,
        },
    }


def _post_listing_json(posts: list[dict], after: str | None = None) -> dict:
    """Build a mock Reddit post listing JSON response."""
    return {
        "kind": "Listing",
        "data": {
            "children": [
                {
                    "kind": "t3",
                    "data": post,
                }
                for post in posts
            ],
            "after": after,
        },
    }


def _comment_json(post_data: dict, comments: list[dict]) -> list:
    """Build a mock Reddit comments page JSON response (post + comments)."""
    return [
        {
            "kind": "Listing",
            "data": {
                "children": [{"kind": "t3", "data": post_data}],
            },
        },
        {
            "kind": "Listing",
            "data": {
                "children": [
                    {"kind": "t1", "data": c}
                    for c in comments
                ],
            },
        },
    ]


@pytest.fixture
def scraper() -> RedditScraper:
    """RedditScraper with rate limiting disabled for fast tests."""
    s = RedditScraper()
    # Disable rate limiting for tests
    s._last_request_time = 0.0
    return s


@pytest.fixture
def mock_response():
    """Factory for mock httpx.Response objects."""
    def _make(json_data, status_code: int = 200):
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = status_code
        resp.json.return_value = json_data
        resp.raise_for_status = MagicMock()
        if status_code >= 400:
            resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                "error", request=MagicMock(), response=resp
            )
        return resp
    return _make


# ---------------------------------------------------------------------------
# Tests: Authentication (always true for scraper)
# ---------------------------------------------------------------------------

class TestAuthentication:
    """The web scraper needs no credentials."""

    def test_is_always_authenticated(self, scraper: RedditScraper) -> None:
        """Web scraper reports as authenticated without any setup."""
        assert scraper.is_authenticated() is True

    def test_validate_credentials_always_succeeds(self, scraper: RedditScraper) -> None:
        """Credential validation always returns success."""
        success, message = scraper.validate_credentials()
        assert success is True
        assert "no credentials" in message.lower()


# ---------------------------------------------------------------------------
# Tests: Subreddit Search
# ---------------------------------------------------------------------------

class TestSearchSubreddits:
    """Tests for search_subreddits method."""

    def test_search_returns_subreddit_info(
        self, scraper: RedditScraper, mock_response
    ) -> None:
        """Searching returns a list of SubredditInfo models."""
        json_data = _subreddit_listing_json([
            {
                "display_name": "mentalhealth",
                "title": "Mental Health Support",
                "subscribers": 523000,
                "public_description": "A community for mental health support.",
                "created_utc": 1300000000.0,
            },
            {
                "display_name": "anxiety",
                "title": "Anxiety Support",
                "subscribers": 410000,
                "public_description": "Support for anxiety sufferers.",
                "created_utc": 1310000000.0,
            },
        ])

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.search_subreddits("mental health", limit=5)

        assert len(results) == 2
        assert all(isinstance(r, SubredditInfo) for r in results)
        assert results[0].name == "mentalhealth"
        assert results[0].subscribers == 523000
        assert results[1].name == "anxiety"

    def test_search_limit_capped(self, scraper: RedditScraper, mock_response) -> None:
        """Search limit is capped at _MAX_SUBREDDIT_SEARCH."""
        json_data = _subreddit_listing_json([])
        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        scraper.search_subreddits("test", limit=999)

        # Verify the limit param was capped to 25
        call_args = scraper._http.get.call_args
        assert call_args[1]["params"]["limit"] == 25

    def test_search_empty_results(self, scraper: RedditScraper, mock_response) -> None:
        """Empty search results return an empty list."""
        json_data = _subreddit_listing_json([])
        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.search_subreddits("nonexistent")
        assert results == []


# ---------------------------------------------------------------------------
# Tests: Get Subreddit Metadata
# ---------------------------------------------------------------------------

class TestGetSubredditMeta:
    """Tests for get_subreddit_meta method."""

    def test_returns_subreddit_info(
        self, scraper: RedditScraper, mock_response
    ) -> None:
        """Getting subreddit metadata returns SubredditInfo."""
        json_data = {
            "kind": "t5",
            "data": {
                "display_name": "mentalhealth",
                "title": "Mental Health Support",
                "subscribers": 523000,
                "public_description": "A community for mental health support.",
                "created_utc": 1300000000.0,
            },
        }
        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        result = scraper.get_subreddit_meta("mentalhealth")

        assert isinstance(result, SubredditInfo)
        assert result.name == "mentalhealth"
        assert result.subscribers == 523000

    def test_caches_result(self, scraper: RedditScraper, mock_response) -> None:
        """Metadata is cached after the first request."""
        # Use a unique name to avoid cross-test cache hits
        unique_name = f"cache_test_{int(time.time())}"
        json_data = {
            "kind": "t5",
            "data": {
                "display_name": unique_name,
                "title": "Test Sub",
                "subscribers": 100,
                "public_description": "Test",
                "created_utc": 1300000000.0,
            },
        }
        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        # First call — hits network
        result1 = scraper.get_subreddit_meta(unique_name)
        # Second call — should use cache
        result2 = scraper.get_subreddit_meta(unique_name)

        assert result1.name == result2.name
        # HTTP client should only have been called once (second call uses cache)
        assert scraper._http.get.call_count == 1

    def test_404_raises_value_error(
        self, scraper: RedditScraper, mock_response
    ) -> None:
        """A 404 response raises ValueError."""
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 404
        scraper._http = MagicMock()
        scraper._http.get.return_value = resp

        with pytest.raises(ValueError, match="not found"):
            scraper.get_subreddit_meta("doesntexist")


# ---------------------------------------------------------------------------
# Tests: Get Posts
# ---------------------------------------------------------------------------

class TestGetPosts:
    """Tests for get_posts method."""

    def test_get_posts_hot(self, scraper: RedditScraper, mock_response) -> None:
        """Getting hot posts returns PostData models."""
        json_data = _post_listing_json([
            {
                "id": "post1",
                "subreddit": "mentalhealth",
                "title": "First post",
                "selftext": "Content one",
                "author": "user1",
                "score": 100,
                "num_comments": 10,
                "created_utc": 1700000000.0,
                "url": "https://reddit.com/r/mentalhealth/post1",
                "permalink": "/r/mentalhealth/comments/post1/",
            },
            {
                "id": "post2",
                "subreddit": "mentalhealth",
                "title": "Second post",
                "selftext": "Content two",
                "author": "user2",
                "score": 50,
                "num_comments": 5,
                "created_utc": 1700001000.0,
                "url": "https://reddit.com/r/mentalhealth/post2",
                "permalink": "/r/mentalhealth/comments/post2/",
            },
        ])

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.get_posts("mentalhealth", sort="hot", limit=10)

        assert len(results) == 2
        assert all(isinstance(r, PostData) for r in results)
        assert results[0].id == "post1"
        assert results[0].title == "First post"
        assert results[0].score == 100
        assert results[1].id == "post2"

    def test_get_posts_limit_capped(self, scraper: RedditScraper, mock_response) -> None:
        """Post limit is capped at _MAX_POSTS."""
        json_data = _post_listing_json([])
        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        scraper.get_posts("test", limit=999)

        call_args = scraper._http.get.call_args
        # Max per-page is 100, and total limit is capped at 250
        assert call_args[1]["params"]["limit"] <= 100

    def test_get_posts_with_search(self, scraper: RedditScraper, mock_response) -> None:
        """Providing a query uses the search endpoint."""
        json_data = _post_listing_json([
            {
                "id": "search1",
                "subreddit": "mentalhealth",
                "title": "Anxiety coping",
                "selftext": "Content",
                "author": "user1",
                "score": 42,
                "num_comments": 3,
                "created_utc": 1700000000.0,
                "url": "https://reddit.com/post",
                "permalink": "/r/mentalhealth/comments/search1/",
            },
        ])

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.get_posts("mentalhealth", query="anxiety coping")

        assert len(results) == 1
        assert results[0].id == "search1"
        # Verify search URL was used
        url = scraper._http.get.call_args[0][0]
        assert "/search.json" in url

    def test_get_posts_deleted_author(self, scraper: RedditScraper, mock_response) -> None:
        """Posts with null/deleted authors show '[deleted]'."""
        json_data = _post_listing_json([
            {
                "id": "del1",
                "subreddit": "test",
                "title": "Deleted author",
                "selftext": "",
                "author": "[deleted]",
                "score": 0,
                "num_comments": 0,
                "created_utc": 1700000000.0,
                "url": "https://reddit.com/post",
                "permalink": "/r/test/comments/del1/",
            },
        ])

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.get_posts("test")
        assert results[0].author == "[deleted]"


# ---------------------------------------------------------------------------
# Tests: Get Comments
# ---------------------------------------------------------------------------

class TestGetComments:
    """Tests for get_comments method."""

    def test_get_comments(self, scraper: RedditScraper, mock_response) -> None:
        """Getting comments returns flattened CommentData models."""
        json_data = _comment_json(
            post_data={"id": "abc123", "title": "Test"},
            comments=[
                {
                    "id": "cmt001",
                    "parent_id": "t3_abc123",
                    "author": "supportive_person",
                    "body": "Thank you for sharing.",
                    "score": 45,
                    "created_utc": 1700001000.0,
                    "depth": 0,
                    "replies": "",
                },
                {
                    "id": "cmt002",
                    "parent_id": "t1_cmt001",
                    "author": "curious_reader",
                    "body": "I had a similar experience.",
                    "score": 12,
                    "created_utc": 1700002000.0,
                    "depth": 1,
                    "replies": "",
                },
            ],
        )

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.get_comments("abc123", depth=3, limit=100)

        assert len(results) == 2
        assert all(isinstance(r, CommentData) for r in results)
        assert results[0].id == "cmt001"
        assert results[0].post_id == "abc123"
        assert results[0].author == "supportive_person"
        assert results[0].depth == 0
        assert results[1].id == "cmt002"
        assert results[1].depth == 1

    def test_get_comments_respects_limit(
        self, scraper: RedditScraper, mock_response
    ) -> None:
        """Comment retrieval stops at the specified limit."""
        json_data = _comment_json(
            post_data={"id": "abc123"},
            comments=[
                {"id": f"cmt{i:03d}", "parent_id": "t3_abc123",
                 "author": f"user{i}", "body": f"Comment {i}",
                 "score": i, "created_utc": 1700000000.0 + i,
                 "depth": 0, "replies": ""}
                for i in range(10)
            ],
        )

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.get_comments("abc123", limit=3)
        assert len(results) == 3

    def test_get_comments_with_nested_replies(
        self, scraper: RedditScraper, mock_response
    ) -> None:
        """Nested reply structures are flattened correctly."""
        json_data = _comment_json(
            post_data={"id": "abc123"},
            comments=[
                {
                    "id": "cmt001",
                    "parent_id": "t3_abc123",
                    "author": "user1",
                    "body": "Top level",
                    "score": 10,
                    "created_utc": 1700001000.0,
                    "depth": 0,
                    "replies": {
                        "kind": "Listing",
                        "data": {
                            "children": [
                                {
                                    "kind": "t1",
                                    "data": {
                                        "id": "cmt002",
                                        "parent_id": "t1_cmt001",
                                        "author": "user2",
                                        "body": "Nested reply",
                                        "score": 5,
                                        "created_utc": 1700002000.0,
                                        "depth": 1,
                                        "replies": "",
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        )

        scraper._http = MagicMock()
        scraper._http.get.return_value = mock_response(json_data)

        results = scraper.get_comments("abc123")

        assert len(results) == 2
        assert results[0].id == "cmt001"
        assert results[0].depth == 0
        assert results[1].id == "cmt002"
        assert results[1].depth == 1


# ---------------------------------------------------------------------------
# Tests: Rate Limit Status
# ---------------------------------------------------------------------------

class TestRateLimitStatus:
    """Tests for get_rate_limit_status method."""

    def test_rate_limit_returns_info(self, scraper: RedditScraper) -> None:
        """Rate limit status returns a RateLimitInfo model."""
        result = scraper.get_rate_limit_status()

        assert isinstance(result, RateLimitInfo)
        assert result.remaining == 30.0  # Fresh scraper, no requests made
        assert result.used == 0

    def test_rate_limit_tracks_requests(self, scraper: RedditScraper) -> None:
        """Rate limit used count reflects actual requests made."""
        scraper._request_count = 5
        result = scraper.get_rate_limit_status()

        assert result.used == 5
        assert result.remaining == 25.0


# ---------------------------------------------------------------------------
# Tests: Error Handling
# ---------------------------------------------------------------------------

class TestErrorHandling:
    """Tests for error responses from Reddit."""

    def test_404_raises_value_error(self, scraper: RedditScraper) -> None:
        """A 404 response raises ValueError."""
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 404
        scraper._http = MagicMock()
        scraper._http.get.return_value = resp

        with pytest.raises(ValueError, match="not found"):
            scraper.get_posts("nonexistent_subreddit")

    def test_403_raises_connection_error(self, scraper: RedditScraper) -> None:
        """A 403 response raises ConnectionError."""
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 403
        scraper._http = MagicMock()
        scraper._http.get.return_value = resp

        with pytest.raises(ConnectionError, match="403"):
            scraper.get_posts("quarantined_sub")
