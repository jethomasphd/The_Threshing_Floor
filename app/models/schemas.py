"""Pydantic v2 schemas for data validation and serialization."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class SubredditInfo(BaseModel):
    """Basic subreddit metadata."""
    name: str
    title: str
    subscribers: int
    description: str
    created_utc: float


class PostData(BaseModel):
    """Reddit post data."""
    id: str
    subreddit: str
    title: str
    selftext: str
    author: str
    score: int
    num_comments: int
    created_utc: float
    url: str
    permalink: str


class CommentData(BaseModel):
    """Reddit comment data."""
    id: str
    post_id: str
    parent_id: Optional[str] = None
    author: str
    body: str
    score: int
    created_utc: float
    depth: int


class RateLimitInfo(BaseModel):
    """Reddit API rate-limit status."""
    remaining: float
    used: int
    reset_timestamp: float


class CollectionConfig(BaseModel):
    """Configuration for a data collection run."""
    subreddit: str
    sort: str = "hot"
    time_filter: str = "all"
    limit: int = 100
    query: Optional[str] = None
    include_comments: bool = False
    comment_depth: int = 0


class ExportConfig(BaseModel):
    """Configuration for data export."""
    format: Literal["csv", "json", "jsonl"]
    include_comments: bool = True
    anonymize_authors: bool = False


class ProvenanceRecord(BaseModel):
    """Provenance metadata for research reproducibility."""
    tool_version: str
    api_endpoints: list[str]
    subreddits: list[str]
    query_params: dict
    collected_at: datetime
    records_collected: int
    records_requested: int
    filters_applied: list[str]
    notes: str = ""
