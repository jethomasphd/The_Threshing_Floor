"""Collection service — orchestrates Reddit data collection.

The Thresh collection engine. Handles multi-step data collection:
post retrieval, optional comment expansion, progress tracking,
deduplication, and error handling. Every collection run is recorded
as a CollectionJob in SQLite for reproducibility and provenance.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.schemas import CollectionConfig, PostData, CommentData
from app.models.tables import CollectionJob, CollectedPost, CollectedComment
from app.services.reddit_client import RedditClient

logger = logging.getLogger(__name__)

# Sensible defaults
_DEFAULT_COMMENT_DEPTH = 3
_DEFAULT_COMMENT_LIMIT = 100
_MAX_COMMENT_DEPTH = 10
_MAX_COMMENT_LIMIT = 500


def _utcnow() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


class CollectionService:
    """Orchestrates Reddit data collection with progress tracking.

    Creates CollectionJob records in the database, collects posts
    and optionally comments via the RedditClient, stores everything
    in SQLite, and tracks progress so the UI can poll for updates.
    """

    def __init__(self, reddit_client: RedditClient, db_session: Session) -> None:
        """Initialize the collection service.

        Args:
            reddit_client: Configured RedditClient instance.
            db_session: SQLAlchemy database session.
        """
        self._reddit = reddit_client
        self._db = db_session

    def start_collection(self, config: CollectionConfig) -> CollectionJob:
        """Start a new collection job.

        Creates a CollectionJob record, collects posts (and optionally
        comments), then marks the job completed or failed.

        Args:
            config: Collection configuration with subreddit, sort, limits, etc.

        Returns:
            The completed (or failed) CollectionJob record.
        """
        # Create the job record
        job = CollectionJob(
            subreddit=config.subreddit,
            status="running",
            total_posts=config.limit,
            collected_posts=0,
            total_comments=0,
            collected_comments=0,
            started_at=_utcnow(),
        )
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)

        logger.info(
            f"Collection job {job.id} started: r/{config.subreddit} "
            f"sort={config.sort} limit={config.limit}"
        )

        try:
            # Collect posts
            posts = self._collect_posts(job, config)

            # Collect comments if requested
            if config.include_comments and posts:
                depth = min(config.comment_depth or _DEFAULT_COMMENT_DEPTH, _MAX_COMMENT_DEPTH)
                # Estimate total comments from post metadata
                estimated_comments = sum(p.num_comments for p in posts)
                job.total_comments = estimated_comments
                self._db.commit()

                for collected_post in posts:
                    try:
                        self._collect_comments(
                            job=job,
                            post=collected_post,
                            depth=depth,
                            limit=_DEFAULT_COMMENT_LIMIT,
                        )
                    except Exception as e:
                        logger.warning(
                            f"Failed to collect comments for post "
                            f"{collected_post.reddit_id}: {e}"
                        )
                        # Continue with other posts even if one fails

            # Mark completed
            job.status = "completed"
            job.completed_at = _utcnow()
            self._db.commit()

            logger.info(
                f"Collection job {job.id} completed: "
                f"{job.collected_posts} posts, {job.collected_comments} comments"
            )

        except Exception as e:
            logger.error(f"Collection job {job.id} failed: {e}")
            job.status = "failed"
            job.error_message = str(e)
            job.completed_at = _utcnow()
            self._db.commit()

        return job

    def _collect_posts(
        self, job: CollectionJob, config: CollectionConfig
    ) -> list[CollectedPost]:
        """Collect posts from a subreddit using the Reddit client.

        Args:
            job: The parent CollectionJob record.
            config: Collection configuration.

        Returns:
            List of CollectedPost records stored in the database.
        """
        post_data_list: list[PostData] = self._reddit.get_posts(
            subreddit=config.subreddit,
            sort=config.sort,
            time_filter=config.time_filter,
            limit=config.limit,
            query=config.query if config.query else None,
        )

        collected: list[CollectedPost] = []

        for post_data in post_data_list:
            # Deduplicate: skip if reddit_id already exists in DB
            existing = (
                self._db.query(CollectedPost)
                .filter(CollectedPost.reddit_id == post_data.id)
                .first()
            )
            if existing is not None:
                logger.debug(f"Skipping duplicate post: {post_data.id}")
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
            self._db.add(post)
            collected.append(post)

            # Update progress
            job.collected_posts = len(collected)
            self._db.commit()

        # Final count update
        job.total_posts = len(post_data_list)
        job.collected_posts = len(collected)
        self._db.commit()

        logger.info(
            f"Job {job.id}: collected {len(collected)} posts "
            f"({len(post_data_list)} fetched, "
            f"{len(post_data_list) - len(collected)} duplicates skipped)"
        )

        return collected

    def _collect_comments(
        self,
        job: CollectionJob,
        post: CollectedPost,
        depth: int = _DEFAULT_COMMENT_DEPTH,
        limit: int = _DEFAULT_COMMENT_LIMIT,
    ) -> list[CollectedComment]:
        """Collect comments for a single post.

        Args:
            job: The parent CollectionJob record.
            post: The CollectedPost to fetch comments for.
            depth: Comment tree expansion depth.
            limit: Maximum comments per post.

        Returns:
            List of CollectedComment records stored in the database.
        """
        limit = min(limit, _MAX_COMMENT_LIMIT)

        comment_data_list: list[CommentData] = self._reddit.get_comments(
            post_id=post.reddit_id,
            depth=depth,
            limit=limit,
        )

        collected: list[CollectedComment] = []

        for comment_data in comment_data_list:
            # Deduplicate by reddit_id
            existing = (
                self._db.query(CollectedComment)
                .filter(CollectedComment.reddit_id == comment_data.id)
                .first()
            )
            if existing is not None:
                logger.debug(f"Skipping duplicate comment: {comment_data.id}")
                continue

            comment = CollectedComment(
                job_id=job.id,
                reddit_id=comment_data.id,
                post_reddit_id=post.reddit_id,
                parent_reddit_id=comment_data.parent_id,
                author=comment_data.author,
                body=comment_data.body,
                score=comment_data.score,
                created_utc=comment_data.created_utc,
                depth=comment_data.depth,
            )
            self._db.add(comment)
            collected.append(comment)

        # Update job progress
        job.collected_comments += len(collected)
        self._db.commit()

        logger.debug(
            f"Job {job.id}: collected {len(collected)} comments "
            f"for post {post.reddit_id}"
        )

        return collected

    def get_job(self, job_id: int) -> CollectionJob | None:
        """Get a collection job by ID.

        Args:
            job_id: The job's primary key.

        Returns:
            The CollectionJob record, or None if not found.
        """
        return (
            self._db.query(CollectionJob)
            .filter(CollectionJob.id == job_id)
            .first()
        )

    def get_recent_jobs(self, limit: int = 10) -> list[CollectionJob]:
        """Get recent collection jobs, most recent first.

        Args:
            limit: Maximum number of jobs to return.

        Returns:
            List of CollectionJob records ordered by start time descending.
        """
        return (
            self._db.query(CollectionJob)
            .order_by(CollectionJob.id.desc())
            .limit(limit)
            .all()
        )

    def get_job_posts(
        self, job_id: int, offset: int = 0, limit: int = 50
    ) -> list[CollectedPost]:
        """Get collected posts for a job with pagination.

        Args:
            job_id: The job's primary key.
            offset: Number of records to skip.
            limit: Maximum number of records to return.

        Returns:
            List of CollectedPost records.
        """
        return (
            self._db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .offset(offset)
            .limit(limit)
            .all()
        )

    def get_job_comments(
        self, job_id: int, post_reddit_id: str | None = None
    ) -> list[CollectedComment]:
        """Get collected comments for a job, optionally filtered by post.

        Args:
            job_id: The job's primary key.
            post_reddit_id: Optional Reddit post ID to filter by.

        Returns:
            List of CollectedComment records.
        """
        query = self._db.query(CollectedComment).filter(
            CollectedComment.job_id == job_id
        )
        if post_reddit_id is not None:
            query = query.filter(
                CollectedComment.post_reddit_id == post_reddit_id
            )
        return query.all()
