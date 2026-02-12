"""Unit tests for the Reddit client PRAW wrapper.

All PRAW calls are mocked — no network access required.
Tests verify that RedditClient methods return proper Pydantic models
and handle errors gracefully.
"""

from unittest.mock import MagicMock, patch

import prawcore
import pytest

from app.config import Settings
from app.models.schemas import (
    CommentData,
    PostData,
    RateLimitInfo,
    SubredditInfo,
)
from app.services.reddit_client import RedditClient
from tests.fixtures.reddit_responses import (
    mock_comment_forest,
    mock_submission,
    mock_subreddit,
)


@pytest.fixture
def mock_settings() -> Settings:
    """Settings with dummy Reddit credentials for testing."""
    return Settings(
        REDDIT_CLIENT_ID="test_client_id",
        REDDIT_CLIENT_SECRET="test_client_secret",
        REDDIT_USER_AGENT="test_user_agent",
        THRESH_DB_PATH=":memory:",
    )


@pytest.fixture
def empty_settings() -> Settings:
    """Settings with no Reddit credentials (setup mode)."""
    return Settings(
        REDDIT_CLIENT_ID=None,
        REDDIT_CLIENT_SECRET=None,
        REDDIT_USER_AGENT=None,
        THRESH_DB_PATH=":memory:",
    )


@pytest.fixture
def client(mock_settings: Settings) -> RedditClient:
    """RedditClient with a mocked PRAW instance."""
    with patch("praw.Reddit") as mock_reddit_cls:
        mock_reddit = MagicMock()
        mock_reddit_cls.return_value = mock_reddit
        with patch("app.services.reddit_client.Cache"):
            reddit_client = RedditClient(mock_settings)
    return reddit_client


@pytest.fixture
def unauthenticated_client(empty_settings: Settings) -> RedditClient:
    """RedditClient with no credentials (setup mode)."""
    with patch("app.services.reddit_client.Cache"):
        reddit_client = RedditClient(empty_settings)
    return reddit_client


class TestSearchSubreddits:
    """Tests for search_subreddits method."""

    def test_search_subreddits(self, client: RedditClient) -> None:
        """Searching subreddits returns a list of SubredditInfo models."""
        mock_subs = [
            mock_subreddit(
                display_name="mentalhealth",
                title="Mental Health Support",
                subscribers=523000,
                public_description="A community for mental health support.",
                created_utc=1300000000.0,
            ),
            mock_subreddit(
                display_name="anxiety",
                title="Anxiety Support",
                subscribers=410000,
                public_description="Support for anxiety sufferers.",
                created_utc=1310000000.0,
            ),
        ]
        client._client.subreddits.search.return_value = mock_subs

        results = client.search_subreddits("mental health", limit=5)

        assert len(results) == 2
        assert all(isinstance(r, SubredditInfo) for r in results)
        assert results[0].name == "mentalhealth"
        assert results[0].title == "Mental Health Support"
        assert results[0].subscribers == 523000
        assert results[0].description == "A community for mental health support."
        assert results[0].created_utc == 1300000000.0
        assert results[1].name == "anxiety"
        client._client.subreddits.search.assert_called_once_with(
            "mental health", limit=5
        )

    def test_search_subreddits_limit_cap(self, client: RedditClient) -> None:
        """Search limit is capped at _MAX_SUBREDDIT_SEARCH."""
        client._client.subreddits.search.return_value = []

        client.search_subreddits("test", limit=999)

        client._client.subreddits.search.assert_called_once_with(
            "test", limit=25
        )

    def test_search_subreddits_unauthenticated(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Searching with no credentials returns an empty list."""
        results = unauthenticated_client.search_subreddits("test")
        assert results == []


class TestGetPosts:
    """Tests for get_posts method."""

    def test_get_posts_hot(self, client: RedditClient) -> None:
        """Getting hot posts returns a list of PostData models."""
        mock_posts = [
            mock_submission(
                id="post1",
                subreddit_name="mentalhealth",
                title="First post",
                selftext="Content one",
                author_name="user1",
                score=100,
                num_comments=10,
                created_utc=1700000000.0,
                url="https://reddit.com/r/mentalhealth/post1",
                permalink="/r/mentalhealth/comments/post1/first_post/",
            ),
            mock_submission(
                id="post2",
                subreddit_name="mentalhealth",
                title="Second post",
                selftext="Content two",
                author_name="user2",
                score=50,
                num_comments=5,
                created_utc=1700001000.0,
                url="https://reddit.com/r/mentalhealth/post2",
                permalink="/r/mentalhealth/comments/post2/second_post/",
            ),
        ]

        mock_sub = MagicMock()
        mock_sub.hot.return_value = mock_posts
        client._client.subreddit.return_value = mock_sub

        results = client.get_posts("mentalhealth", sort="hot", limit=10)

        assert len(results) == 2
        assert all(isinstance(r, PostData) for r in results)
        assert results[0].id == "post1"
        assert results[0].subreddit == "mentalhealth"
        assert results[0].title == "First post"
        assert results[0].selftext == "Content one"
        assert results[0].author == "user1"
        assert results[0].score == 100
        assert results[0].num_comments == 10
        assert results[0].url == "https://reddit.com/r/mentalhealth/post1"
        assert results[0].permalink == "/r/mentalhealth/comments/post1/first_post/"
        mock_sub.hot.assert_called_once_with(limit=10)

    def test_get_posts_top_with_time_filter(self, client: RedditClient) -> None:
        """Getting top posts passes time_filter correctly."""
        mock_sub = MagicMock()
        mock_sub.top.return_value = []
        client._client.subreddit.return_value = mock_sub

        client.get_posts(
            "mentalhealth", sort="top", time_filter="week", limit=10
        )

        mock_sub.top.assert_called_once_with(time_filter="week", limit=10)

    def test_get_posts_with_search(self, client: RedditClient) -> None:
        """Providing a query triggers subreddit search instead of listing."""
        mock_posts = [
            mock_submission(
                id="search1",
                title="Anxiety coping mechanisms",
                selftext="Search result content",
            ),
        ]

        mock_sub = MagicMock()
        mock_sub.search.return_value = mock_posts
        client._client.subreddit.return_value = mock_sub

        results = client.get_posts(
            "mentalhealth",
            sort="hot",
            time_filter="all",
            limit=10,
            query="anxiety coping",
        )

        assert len(results) == 1
        assert results[0].id == "search1"
        assert results[0].title == "Anxiety coping mechanisms"
        mock_sub.search.assert_called_once_with(
            "anxiety coping",
            sort="hot",
            time_filter="all",
            limit=10,
        )

    def test_get_posts_deleted_author(self, client: RedditClient) -> None:
        """Posts with deleted authors show '[deleted]'."""
        deleted_post = mock_submission(id="del1")
        deleted_post.author = None  # Deleted user

        mock_sub = MagicMock()
        mock_sub.hot.return_value = [deleted_post]
        client._client.subreddit.return_value = mock_sub

        results = client.get_posts("mentalhealth")

        assert results[0].author == "[deleted]"

    def test_get_posts_unauthenticated(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Getting posts with no credentials returns an empty list."""
        results = unauthenticated_client.get_posts("mentalhealth")
        assert results == []


class TestGetComments:
    """Tests for get_comments method."""

    def test_get_comments(self, client: RedditClient) -> None:
        """Getting comments returns a flattened list of CommentData models."""
        mock_comments = mock_comment_forest(post_id="abc123")

        mock_comment_list = MagicMock()
        mock_comment_list.replace_more = MagicMock()
        mock_comment_list.list.return_value = mock_comments

        mock_sub = MagicMock()
        mock_sub.comments = mock_comment_list
        client._client.submission.return_value = mock_sub

        results = client.get_comments("abc123", depth=3, limit=100)

        assert len(results) == 4
        assert all(isinstance(r, CommentData) for r in results)

        # Verify first comment
        assert results[0].id == "cmt001"
        assert results[0].post_id == "abc123"
        assert results[0].parent_id == "t3_abc123"
        assert results[0].author == "supportive_person"
        assert results[0].body == "Thank you for sharing this."
        assert results[0].score == 45
        assert results[0].depth == 0

        # Verify nested comment
        assert results[1].id == "cmt002"
        assert results[1].parent_id == "t1_cmt001"
        assert results[1].depth == 1

        # Verify replace_more was called with bounded limit
        mock_comment_list.replace_more.assert_called_once_with(limit=3)

    def test_get_comments_respects_limit(self, client: RedditClient) -> None:
        """Comment retrieval stops at the specified limit."""
        mock_comments = mock_comment_forest(post_id="abc123")

        mock_comment_list = MagicMock()
        mock_comment_list.replace_more = MagicMock()
        mock_comment_list.list.return_value = mock_comments

        mock_sub = MagicMock()
        mock_sub.comments = mock_comment_list
        client._client.submission.return_value = mock_sub

        results = client.get_comments("abc123", depth=3, limit=2)

        assert len(results) == 2

    def test_get_comments_unauthenticated(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Getting comments with no credentials returns an empty list."""
        results = unauthenticated_client.get_comments("abc123")
        assert results == []


class TestRateLimitStatus:
    """Tests for get_rate_limit_status method."""

    def test_rate_limit_status(self, client: RedditClient) -> None:
        """Rate limit status returns a RateLimitInfo model."""
        # Mock the PRAW rate limiter internals
        mock_rate_limiter = MagicMock()
        mock_rate_limiter.remaining = 95.0
        mock_rate_limiter.used = 5
        mock_rate_limiter.reset_timestamp = 1700000060.0
        client._client._core._rate_limiter = mock_rate_limiter

        result = client.get_rate_limit_status()

        assert isinstance(result, RateLimitInfo)
        assert result.remaining == 95.0
        assert result.used == 5
        assert result.reset_timestamp == 1700000060.0

    def test_rate_limit_status_fallback(self, client: RedditClient) -> None:
        """Rate limit falls back to internal counter when PRAW info unavailable."""
        # Mock _core._rate_limiter with attributes set to None so the
        # fallback logic activates (remaining_val is None -> uses default)
        mock_rate_limiter = MagicMock(spec=[])  # Empty spec = no auto-attributes
        client._client._core._rate_limiter = mock_rate_limiter
        # Set the internal counter
        client._request_count = 7

        result = client.get_rate_limit_status()

        assert isinstance(result, RateLimitInfo)
        # With no attributes on rate_limiter, getattr returns None defaults:
        # remaining -> 100.0 (default), used -> self._request_count (7)
        assert result.remaining == 100.0
        assert result.used == 7

    def test_rate_limit_status_unauthenticated(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Rate limit status when unauthenticated returns zeros."""
        result = unauthenticated_client.get_rate_limit_status()

        assert isinstance(result, RateLimitInfo)
        assert result.remaining == 0.0
        assert result.used == 0


class TestAuthentication:
    """Tests for is_authenticated and validate_credentials."""

    def test_unauthenticated_client(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Client with no credentials is not authenticated."""
        assert unauthenticated_client.is_authenticated() is False
        assert unauthenticated_client._client is None

    def test_validate_credentials_success(
        self, client: RedditClient
    ) -> None:
        """Successful credentials validation returns (True, message)."""
        client._client.auth.scopes.return_value = {"read"}

        success, message = client.validate_credentials()

        assert success is True
        assert "valid" in message.lower()

    def test_validate_credentials_failure(
        self, client: RedditClient
    ) -> None:
        """Failed credentials validation returns (False, error message)."""
        client._client.auth.scopes.side_effect = (
            prawcore.exceptions.OAuthException(
                MagicMock(), 401, "Unauthorized"
            )
        )

        success, message = client.validate_credentials()

        assert success is False
        assert "Invalid credentials" in message

    def test_validate_credentials_network_error(
        self, client: RedditClient
    ) -> None:
        """Network error during validation returns appropriate message."""
        client._client.auth.scopes.side_effect = (
            prawcore.exceptions.RequestException(
                MagicMock(), MagicMock(), MagicMock()
            )
        )

        success, message = client.validate_credentials()

        assert success is False
        assert "Could not reach Reddit" in message

    def test_validate_credentials_no_config(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Validation with no credentials returns config error."""
        success, message = unauthenticated_client.validate_credentials()

        assert success is False
        assert "not configured" in message.lower()

    def test_is_authenticated_true(self, client: RedditClient) -> None:
        """Client with working credentials reports as authenticated."""
        client._client.auth.scopes.return_value = {"read"}

        assert client.is_authenticated() is True

    def test_is_authenticated_false_on_error(
        self, client: RedditClient
    ) -> None:
        """Client reports not authenticated when API call fails."""
        client._client.auth.scopes.side_effect = Exception("API error")

        assert client.is_authenticated() is False


class TestGetSubredditMeta:
    """Tests for get_subreddit_meta method."""

    def test_get_subreddit_meta(self, client: RedditClient) -> None:
        """Getting subreddit metadata returns SubredditInfo."""
        mock_sub = mock_subreddit(
            display_name="mentalhealth",
            title="Mental Health Support",
            subscribers=523000,
            public_description="A community for mental health support.",
            created_utc=1300000000.0,
        )
        client._client.subreddit.return_value = mock_sub
        # Ensure cache miss
        client._cache.retrieve.return_value = None

        result = client.get_subreddit_meta("mentalhealth")

        assert isinstance(result, SubredditInfo)
        assert result.name == "mentalhealth"
        assert result.title == "Mental Health Support"
        assert result.subscribers == 523000

    def test_get_subreddit_meta_cached(self, client: RedditClient) -> None:
        """Subreddit metadata is returned from cache when available."""
        cached_json = SubredditInfo(
            name="mentalhealth",
            title="Mental Health Support",
            subscribers=523000,
            description="Cached description.",
            created_utc=1300000000.0,
        ).model_dump_json()
        client._cache.retrieve.return_value = cached_json

        result = client.get_subreddit_meta("mentalhealth")

        assert isinstance(result, SubredditInfo)
        assert result.description == "Cached description."
        # Should NOT have called the PRAW API
        client._client.subreddit.assert_not_called()

    def test_get_subreddit_meta_unauthenticated(
        self, unauthenticated_client: RedditClient
    ) -> None:
        """Getting metadata without credentials raises RuntimeError."""
        with pytest.raises(RuntimeError, match="not configured"):
            unauthenticated_client.get_subreddit_meta("mentalhealth")
