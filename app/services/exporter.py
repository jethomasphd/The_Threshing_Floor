"""Export service — transforms collected data into research-ready bundles.

The Glean engine. Produces CSV, JSON, or JSONL exports wrapped in a ZIP
archive alongside a provenance.txt sidecar. Every bundle is sealed with
full methodology documentation so anyone reviewing the work sees exactly
how the data was collected. Reproducibility depends on this.
"""

import csv
import io
import json
import logging
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.schemas import ExportConfig
from app.models.tables import CollectedComment, CollectedPost, CollectionJob, ExportRecord

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


def _format_utc(dt: datetime | None) -> str:
    """Format a datetime as an ISO-like UTC string.

    Args:
        dt: A datetime object or None.

    Returns:
        Formatted UTC string, or 'N/A' if dt is None.
    """
    if dt is None:
        return "N/A"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S UTC")


def _format_count(n: int) -> str:
    """Format an integer with comma separators.

    Args:
        n: Integer count.

    Returns:
        Comma-formatted string.
    """
    return f"{n:,}"


class ExportService:
    """Transforms collected Reddit data into exportable ZIP bundles.

    Each bundle contains the data file (CSV, JSON, or JSONL) plus a
    provenance.txt sidecar documenting exactly how the data was collected
    and exported. The provenance document is non-negotiable.
    """

    def __init__(self, db_session: Session) -> None:
        """Initialize the export service.

        Args:
            db_session: SQLAlchemy database session.
        """
        self.db = db_session
        self.export_dir = Path(get_settings().THRESH_EXPORT_DIR)
        self.export_dir.mkdir(parents=True, exist_ok=True)

    def export_job(self, job_id: int, config: ExportConfig) -> Path:
        """Export a collection job's data to a ZIP file.

        Args:
            job_id: ID of the CollectionJob to export.
            config: Export configuration (format, comments, anonymization).

        Returns:
            Path to the created ZIP file.

        Raises:
            ValueError: If the job is not found or not completed.
        """
        # 1. Load job
        job = self.db.query(CollectionJob).filter(CollectionJob.id == job_id).first()
        if job is None:
            raise ValueError(f"Collection job {job_id} not found.")
        if job.status != "completed":
            raise ValueError(
                f"Collection job {job_id} is not completed (status: {job.status}). "
                "Only completed jobs can be exported."
            )

        # 2. Load posts
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .order_by(CollectedPost.created_utc.desc())
            .all()
        )

        # 3. Load comments (if requested)
        comments: list[CollectedComment] = []
        if config.include_comments:
            comments = (
                self.db.query(CollectedComment)
                .filter(CollectedComment.job_id == job_id)
                .order_by(CollectedComment.created_utc.asc())
                .all()
            )

        # 4. Build author mapping for anonymization
        author_mapping: dict[str, str] = {}

        # 5. Build data in requested format
        if config.format == "csv":
            data_content = self._export_csv(posts, comments, config.anonymize_authors, author_mapping)
            data_filename = f"thresh_r-{job.subreddit}_job{job.id}.csv"
        elif config.format == "json":
            data_content = self._export_json(posts, comments, config.anonymize_authors, author_mapping)
            data_filename = f"thresh_r-{job.subreddit}_job{job.id}.json"
        elif config.format == "jsonl":
            data_content = self._export_jsonl(posts, comments, config.anonymize_authors, author_mapping)
            data_filename = f"thresh_r-{job.subreddit}_job{job.id}.jsonl"
        else:
            raise ValueError(f"Unsupported export format: {config.format}")

        # 6. Generate provenance.txt
        provenance_content = self._generate_provenance(
            job=job,
            config=config,
            post_count=len(posts),
            comment_count=len(comments),
            author_mapping=author_mapping,
        )

        # 7. Create ZIP with data file + provenance.txt
        timestamp_str = _utcnow().strftime("%Y%m%d_%H%M%S")
        zip_filename = f"thresh_r-{job.subreddit}_job{job.id}_{timestamp_str}.zip"
        zip_path = self.export_dir / zip_filename

        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(data_filename, data_content)
            zf.writestr("provenance.txt", provenance_content)

        # 8. Record in ExportRecord table
        file_size = zip_path.stat().st_size
        export_record = ExportRecord(
            job_id=job_id,
            format=config.format,
            file_path=str(zip_path),
            record_count=len(posts),
            includes_comments=config.include_comments,
            anonymized=config.anonymize_authors,
        )
        self.db.add(export_record)
        self.db.commit()

        logger.info(
            f"Export completed: job {job_id} -> {zip_path} "
            f"({len(posts)} posts, {len(comments)} comments, "
            f"format={config.format}, size={file_size} bytes)"
        )

        return zip_path

    def _export_csv(
        self,
        posts: list[CollectedPost],
        comments: list[CollectedComment],
        anonymize: bool,
        author_mapping: dict[str, str],
    ) -> str:
        """Export to CSV with UTF-8 BOM for Excel compatibility.

        Args:
            posts: List of CollectedPost records.
            comments: List of CollectedComment records.
            anonymize: Whether to anonymize author names.
            author_mapping: Mutable mapping of real -> anonymized authors.

        Returns:
            CSV string with UTF-8 BOM prefix.
        """
        output = io.StringIO()
        # UTF-8 BOM for Excel
        output.write("\ufeff")

        # Posts CSV
        post_writer = csv.writer(output)
        post_writer.writerow([
            "id", "subreddit", "title", "selftext", "author", "score",
            "num_comments", "created_utc", "url", "permalink",
        ])

        for post in posts:
            author = self._anonymize_author(post.author, author_mapping) if anonymize else post.author
            post_writer.writerow([
                post.reddit_id,
                post.subreddit,
                post.title,
                post.selftext,
                author,
                post.score,
                post.num_comments,
                post.created_utc,
                post.url,
                post.permalink,
            ])

        # Comments section (if any)
        if comments:
            output.write("\n")
            comment_writer = csv.writer(output)
            comment_writer.writerow([
                "comment_id", "post_id", "parent_id", "author", "body",
                "score", "created_utc", "depth",
            ])

            for comment in comments:
                author = self._anonymize_author(comment.author, author_mapping) if anonymize else comment.author
                comment_writer.writerow([
                    comment.reddit_id,
                    comment.post_reddit_id,
                    comment.parent_reddit_id or "",
                    author,
                    comment.body,
                    comment.score,
                    comment.created_utc,
                    comment.depth,
                ])

        return output.getvalue()

    def _export_json(
        self,
        posts: list[CollectedPost],
        comments: list[CollectedComment],
        anonymize: bool,
        author_mapping: dict[str, str],
    ) -> str:
        """Export to pretty-printed JSON.

        Posts are the top-level array. If comments are included, each
        post has a 'comments' key with its nested comment list.

        Args:
            posts: List of CollectedPost records.
            comments: List of CollectedComment records.
            anonymize: Whether to anonymize author names.
            author_mapping: Mutable mapping of real -> anonymized authors.

        Returns:
            Pretty-printed JSON string.
        """
        # Group comments by post
        comments_by_post: dict[str, list[CollectedComment]] = {}
        for comment in comments:
            comments_by_post.setdefault(comment.post_reddit_id, []).append(comment)

        result = []
        for post in posts:
            author = self._anonymize_author(post.author, author_mapping) if anonymize else post.author
            post_dict: dict = {
                "id": post.reddit_id,
                "subreddit": post.subreddit,
                "title": post.title,
                "selftext": post.selftext,
                "author": author,
                "score": post.score,
                "num_comments": post.num_comments,
                "created_utc": post.created_utc,
                "url": post.url,
                "permalink": post.permalink,
            }

            # Attach comments if present
            post_comments = comments_by_post.get(post.reddit_id, [])
            if post_comments:
                post_dict["comments"] = [
                    {
                        "id": c.reddit_id,
                        "post_id": c.post_reddit_id,
                        "parent_id": c.parent_reddit_id,
                        "author": self._anonymize_author(c.author, author_mapping) if anonymize else c.author,
                        "body": c.body,
                        "score": c.score,
                        "created_utc": c.created_utc,
                        "depth": c.depth,
                    }
                    for c in post_comments
                ]

            result.append(post_dict)

        return json.dumps(result, indent=2, ensure_ascii=False)

    def _export_jsonl(
        self,
        posts: list[CollectedPost],
        comments: list[CollectedComment],
        anonymize: bool,
        author_mapping: dict[str, str],
    ) -> str:
        """Export to JSON Lines (one JSON object per line).

        Posts are written first, then comments (each clearly marked
        by a 'type' field).

        Args:
            posts: List of CollectedPost records.
            comments: List of CollectedComment records.
            anonymize: Whether to anonymize author names.
            author_mapping: Mutable mapping of real -> anonymized authors.

        Returns:
            JSONL string (one JSON object per line).
        """
        lines: list[str] = []

        for post in posts:
            author = self._anonymize_author(post.author, author_mapping) if anonymize else post.author
            post_dict = {
                "type": "post",
                "id": post.reddit_id,
                "subreddit": post.subreddit,
                "title": post.title,
                "selftext": post.selftext,
                "author": author,
                "score": post.score,
                "num_comments": post.num_comments,
                "created_utc": post.created_utc,
                "url": post.url,
                "permalink": post.permalink,
            }
            lines.append(json.dumps(post_dict, ensure_ascii=False))

        for comment in comments:
            author = self._anonymize_author(comment.author, author_mapping) if anonymize else comment.author
            comment_dict = {
                "type": "comment",
                "id": comment.reddit_id,
                "post_id": comment.post_reddit_id,
                "parent_id": comment.parent_reddit_id,
                "author": author,
                "body": comment.body,
                "score": comment.score,
                "created_utc": comment.created_utc,
                "depth": comment.depth,
            }
            lines.append(json.dumps(comment_dict, ensure_ascii=False))

        return "\n".join(lines) + "\n" if lines else ""

    def _generate_provenance(
        self,
        job: CollectionJob,
        config: ExportConfig,
        post_count: int,
        comment_count: int,
        author_mapping: dict[str, str] | None = None,
    ) -> str:
        """Generate provenance.txt content. THIS IS NON-NEGOTIABLE.

        Every export MUST include this document for academic reproducibility.

        Args:
            job: The CollectionJob being exported.
            config: Export configuration.
            post_count: Actual number of posts in the export.
            comment_count: Actual number of comments in the export.
            author_mapping: Mapping of real -> anonymized authors (if anonymized).

        Returns:
            The full provenance.txt content string.
        """
        settings = get_settings()
        version = settings.THRESH_VERSION
        now = _utcnow()

        # Determine collection method and endpoints used
        from app.services.reddit_client import has_api_credentials

        if has_api_credentials():
            collection_method = "Reddit API (authenticated via PRAW)"
        else:
            collection_method = "Reddit public web data (no API key)"

        endpoints: list[str] = []
        if job.saved_query_id is not None:
            query = self.db.query(
                __import__("app.models.tables", fromlist=["SavedQuery"]).SavedQuery
            ).filter_by(id=job.saved_query_id).first()
        else:
            query = None

        # Infer endpoints from collection parameters
        endpoints.append(f"subreddit.{query.sort if query else 'hot'}")
        if query and query.query:
            endpoints.append("subreddit.search")

        # Format strings
        format_display = {
            "csv": "CSV (UTF-8 with BOM)",
            "json": "JSON (pretty-printed)",
            "jsonl": "JSON Lines (streaming)",
        }

        # Determine search query
        search_query = "(none)"
        sort_method = "hot"
        time_filter = "all"
        max_requested = job.total_posts
        if query:
            search_query = query.query if query.query else "(none)"
            sort_method = query.sort or "hot"
            time_filter = query.time_filter or "all"
            max_requested = query.limit or job.total_posts

        # Unavailable post count
        unavailable = max(0, max_requested - post_count)
        unavailable_note = (
            f"{unavailable} post(s) were unavailable (deleted/removed/duplicate) at collection time."
            if unavailable > 0
            else "All requested posts were available at collection time."
        )

        # Rate limit notes
        rate_note = "No rate limit interruptions were recorded during collection."
        if job.error_message:
            rate_note = f"Note: {job.error_message}"

        # Author mapping info
        author_info = "N/A (usernames included as-is)"
        if config.anonymize_authors and author_mapping:
            unique_count = len(author_mapping)
            if unique_count > 0:
                first_id = "author_0001"
                last_id = f"author_{unique_count:04d}"
                author_info = f"{unique_count} unique authors -> {first_id} through {last_id}"
            else:
                author_info = "No authors to anonymize"

        provenance = f"""=====================================
PROVENANCE — The Threshing Floor
=====================================

Tool: Thresh (The Threshing Floor) v{version}
Export Date: {_format_utc(now)}
Collection Method: {collection_method}

--- Collection Details ---
Data Source(s): {", ".join(endpoints)}
Subreddit(s): r/{job.subreddit}
Sort Method: {sort_method}
Time Filter: {time_filter}
Search Query: {search_query}
Max Posts Requested: {_format_count(max_requested)}
Posts Collected: {_format_count(post_count)}
Comments Collected: {_format_count(comment_count)}
Collection Date: {_format_utc(job.started_at)}

--- Export Configuration ---
Format: {format_display.get(config.format, config.format)}
Comments Included: {"Yes" if config.include_comments else "No"}
Usernames Anonymized: {"Yes" if config.anonymize_authors else "No"}
Author Mapping: {author_info}

--- Post-Collection Notes ---
{unavailable_note}
{rate_note}

--- Ethical Notice ---
This dataset was collected from publicly available Reddit data.
If using for research, consult your organization's ethics board
regarding human subjects review for social media data.

--- Citation ---
Thomas, J. E. (2025). Thresh: The Threshing Floor (Version {version})
[Computer software].
=====================================
"""
        return provenance

    def _anonymize_author(self, author: str, mapping: dict[str, str]) -> str:
        """Map an author to an anonymized ID.

        Args:
            author: Original Reddit username.
            mapping: Mutable mapping of real -> anonymized author IDs.

        Returns:
            Anonymized author ID like 'author_0001'.
        """
        if author not in mapping:
            mapping[author] = f"author_{len(mapping) + 1:04d}"
        return mapping[author]

    def get_exports(self, job_id: int | None = None) -> list[ExportRecord]:
        """Get export records, optionally filtered by job.

        Args:
            job_id: Optional job ID to filter by.

        Returns:
            List of ExportRecord objects, most recent first.
        """
        query = self.db.query(ExportRecord).order_by(ExportRecord.exported_at.desc())
        if job_id is not None:
            query = query.filter(ExportRecord.job_id == job_id)
        return query.all()

    def get_export_by_id(self, export_id: int) -> ExportRecord | None:
        """Get a single export record by ID.

        Args:
            export_id: The export record's primary key.

        Returns:
            The ExportRecord, or None if not found.
        """
        return self.db.query(ExportRecord).filter(ExportRecord.id == export_id).first()

    def get_export_path(self, export_id: int) -> Path | None:
        """Get the file path for a specific export.

        Args:
            export_id: The export record's primary key.

        Returns:
            Path to the ZIP file, or None if not found or file missing.
        """
        record = self.get_export_by_id(export_id)
        if record is None:
            return None
        path = Path(record.file_path)
        if not path.exists():
            logger.warning(f"Export file missing: {path}")
            return None
        return path
