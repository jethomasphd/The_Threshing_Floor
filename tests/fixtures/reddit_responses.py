"""Mock data that mimics PRAW objects for testing.

Uses SimpleNamespace objects to replicate PRAW's attribute access pattern
without requiring actual PRAW objects or network calls.
"""

from types import SimpleNamespace


def mock_subreddit(
    display_name: str = "mentalhealth",
    title: str = "Mental Health Support",
    subscribers: int = 523000,
    public_description: str = "A community for mental health support and discussion.",
    created_utc: float = 1300000000.0,
    over18: bool = False,
    subreddit_type: str = "public",
) -> SimpleNamespace:
    """Create a mock subreddit object mimicking PRAW's Subreddit.

    Args:
        display_name: Subreddit display name.
        title: Subreddit title.
        subscribers: Number of subscribers.
        public_description: Public description text.
        created_utc: Creation timestamp (Unix epoch).
        over18: Whether the subreddit is NSFW.
        subreddit_type: Type of subreddit (public/private/restricted).

    Returns:
        SimpleNamespace mimicking a PRAW Subreddit object.
    """
    return SimpleNamespace(
        display_name=display_name,
        title=title,
        subscribers=subscribers,
        public_description=public_description,
        created_utc=created_utc,
        over18=over18,
        subreddit_type=subreddit_type,
    )


def mock_submission(
    id: str = "abc123",
    subreddit_name: str = "mentalhealth",
    title: str = "How I learned to cope with anxiety",
    selftext: str = "This is my story about dealing with anxiety...",
    author_name: str = "helpful_user",
    score: int = 142,
    num_comments: int = 37,
    created_utc: float = 1700000000.0,
    url: str = "https://www.reddit.com/r/mentalhealth/comments/abc123/how_i_learned_to_cope/",
    permalink: str = "/r/mentalhealth/comments/abc123/how_i_learned_to_cope/",
) -> SimpleNamespace:
    """Create a mock submission object mimicking PRAW's Submission.

    Args:
        id: Submission ID.
        subreddit_name: Name of the subreddit.
        title: Post title.
        selftext: Post body text.
        author_name: Author username.
        score: Post score.
        num_comments: Number of comments.
        created_utc: Creation timestamp (Unix epoch).
        url: Full URL.
        permalink: Reddit permalink.

    Returns:
        SimpleNamespace mimicking a PRAW Submission object.
    """
    return SimpleNamespace(
        id=id,
        subreddit=SimpleNamespace(display_name=subreddit_name),
        title=title,
        selftext=selftext,
        author=SimpleNamespace(name=author_name),
        score=score,
        num_comments=num_comments,
        created_utc=created_utc,
        url=url,
        permalink=permalink,
    )


def mock_comment(
    id: str = "cmt001",
    parent_id: str = "t3_abc123",
    author_name: str = "supportive_person",
    body: str = "Thank you for sharing. Here are some resources...",
    score: int = 45,
    created_utc: float = 1700001000.0,
    depth: int = 0,
) -> SimpleNamespace:
    """Create a mock comment object mimicking PRAW's Comment.

    Args:
        id: Comment ID.
        parent_id: Parent ID (t3_ for post, t1_ for comment).
        author_name: Author username.
        body: Comment body text.
        score: Comment score.
        created_utc: Creation timestamp (Unix epoch).
        depth: Nesting depth (0 = top-level).

    Returns:
        SimpleNamespace mimicking a PRAW Comment object.
    """
    return SimpleNamespace(
        id=id,
        parent_id=parent_id,
        author=SimpleNamespace(name=author_name),
        body=body,
        score=score,
        created_utc=created_utc,
        depth=depth,
    )


def mock_comment_forest(post_id: str = "abc123") -> list[SimpleNamespace]:
    """Create a list of mock comments simulating a flattened comment forest.

    Args:
        post_id: The parent post ID.

    Returns:
        List of SimpleNamespace objects mimicking flattened PRAW comments.
    """
    return [
        mock_comment(
            id="cmt001",
            parent_id=f"t3_{post_id}",
            author_name="supportive_person",
            body="Thank you for sharing this.",
            score=45,
            created_utc=1700001000.0,
            depth=0,
        ),
        mock_comment(
            id="cmt002",
            parent_id="t1_cmt001",
            author_name="curious_reader",
            body="I had a similar experience. Can you elaborate?",
            score=12,
            created_utc=1700002000.0,
            depth=1,
        ),
        mock_comment(
            id="cmt003",
            parent_id="t1_cmt001",
            author_name="therapist_here",
            body="As a professional, I recommend...",
            score=78,
            created_utc=1700003000.0,
            depth=1,
        ),
        mock_comment(
            id="cmt004",
            parent_id=f"t3_{post_id}",
            author_name="anonymous_helper",
            body="Resources: NAMI, crisis hotline...",
            score=90,
            created_utc=1700004000.0,
            depth=0,
        ),
    ]
