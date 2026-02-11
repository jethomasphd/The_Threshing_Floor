"""SQLAlchemy ORM table definitions."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SavedQuery(Base):
    """A saved/reusable collection query."""
    __tablename__ = "saved_queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    subreddit: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[str] = mapped_column(String(50), default="hot")
    time_filter: Mapped[str] = mapped_column(String(50), default="all")
    limit: Mapped[int] = mapped_column(Integer, default=100)
    query: Mapped[str] = mapped_column(Text, default="")
    include_comments: Mapped[bool] = mapped_column(Boolean, default=False)
    comment_depth: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)

    # Relationships
    jobs: Mapped[list["CollectionJob"]] = relationship(back_populates="saved_query")


class CollectionJob(Base):
    """A single data collection job."""
    __tablename__ = "collection_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    saved_query_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("saved_queries.id"), nullable=True)
    subreddit: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("pending", "running", "completed", "failed", name="job_status"),
        default="pending",
    )
    total_posts: Mapped[int] = mapped_column(Integer, default=0)
    collected_posts: Mapped[int] = mapped_column(Integer, default=0)
    total_comments: Mapped[int] = mapped_column(Integer, default=0)
    collected_comments: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    # Relationships
    saved_query: Mapped[SavedQuery | None] = relationship(back_populates="jobs")
    posts: Mapped[list["CollectedPost"]] = relationship(back_populates="job")
    comments: Mapped[list["CollectedComment"]] = relationship(back_populates="job")
    exports: Mapped[list["ExportRecord"]] = relationship(back_populates="job")


class CollectedPost(Base):
    """A collected Reddit post."""
    __tablename__ = "collected_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("collection_jobs.id"), nullable=False)
    reddit_id: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    subreddit: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    selftext: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str] = mapped_column(String(255), default="[deleted]")
    score: Mapped[int] = mapped_column(Integer, default=0)
    num_comments: Mapped[int] = mapped_column(Integer, default=0)
    created_utc: Mapped[float] = mapped_column(Float, nullable=False)
    url: Mapped[str] = mapped_column(Text, default="")
    permalink: Mapped[str] = mapped_column(Text, default="")
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    # Relationships
    job: Mapped[CollectionJob] = relationship(back_populates="posts")


class CollectedComment(Base):
    """A collected Reddit comment."""
    __tablename__ = "collected_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("collection_jobs.id"), nullable=False)
    reddit_id: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    post_reddit_id: Mapped[str] = mapped_column(String(20), nullable=False)
    parent_reddit_id: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    author: Mapped[str] = mapped_column(String(255), default="[deleted]")
    body: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[int] = mapped_column(Integer, default=0)
    created_utc: Mapped[float] = mapped_column(Float, nullable=False)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    # Relationships
    job: Mapped[CollectionJob] = relationship(back_populates="comments")


class ExportRecord(Base):
    """Record of a data export."""
    __tablename__ = "export_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("collection_jobs.id"), nullable=False)
    format: Mapped[str] = mapped_column(String(10), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    exported_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    includes_comments: Mapped[bool] = mapped_column(Boolean, default=False)
    anonymized: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    job: Mapped[CollectionJob] = relationship(back_populates="exports")
