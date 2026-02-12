"""Text analysis service for collected Reddit data — the winnowing.

Provides word frequency analysis, bigram extraction, temporal distribution,
keyword tracking, author statistics, and engagement metrics. Pure Python
text analysis with no ML dependencies.
"""

import math
import re
import logging
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.tables import CollectedPost, CollectedComment

logger = logging.getLogger(__name__)


class AnalyzerService:
    """Text analysis for collected Reddit data — the winnowing."""

    # Common English stopwords — hardcoded to avoid NLTK runtime dependency.
    STOPWORDS: set[str] = {
        "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you",
        "your", "yours", "yourself", "yourselves", "he", "him", "his",
        "himself", "she", "her", "hers", "herself", "it", "its", "itself",
        "they", "them", "their", "theirs", "themselves", "what", "which",
        "who", "whom", "this", "that", "these", "those", "am", "is", "are",
        "was", "were", "be", "been", "being", "have", "has", "had", "having",
        "do", "does", "did", "doing", "a", "an", "the", "and", "but", "if",
        "or", "because", "as", "until", "while", "of", "at", "by", "for",
        "with", "about", "against", "between", "through", "during", "before",
        "after", "above", "below", "to", "from", "up", "down", "in", "out",
        "on", "off", "over", "under", "again", "further", "then", "once",
        "here", "there", "when", "where", "why", "how", "all", "both",
        "each", "few", "more", "most", "other", "some", "such", "no",
        "nor", "not", "only", "own", "same", "so", "than", "too", "very",
        "s", "t", "can", "will", "just", "don", "should", "now", "d", "ll",
        "m", "o", "re", "ve", "y", "ain", "aren", "couldn", "didn",
        "doesn", "hadn", "hasn", "haven", "isn", "ma", "mightn", "mustn",
        "needn", "shan", "shouldn", "wasn", "weren", "won", "wouldn",
        "also", "could", "would", "like", "get", "got", "really",
        "know", "think", "one", "even", "much", "still", "going",
        "want", "make", "people", "well", "right", "go", "way",
        "deleted", "removed", "http", "https", "www", "com",
        "amp", "gt", "lt", "nbsp",
    }

    def __init__(self, db_session: Session) -> None:
        self.db = db_session

    # ------------------------------------------------------------------
    # Public analysis methods
    # ------------------------------------------------------------------

    def get_word_frequencies(
        self,
        job_id: int,
        top_n: int = 50,
        include_comments: bool = True,
        min_word_length: int = 3,
    ) -> list[tuple[str, int]]:
        """Get top word frequencies from collected text.

        Tokenises all post titles, self-texts, and (optionally) comment
        bodies, removes stopwords, and returns the most common words.

        Args:
            job_id: The collection job to analyse.
            top_n: Number of top words to return.
            include_comments: Whether to include comment text.
            min_word_length: Minimum word length to include.

        Returns:
            List of ``(word, count)`` tuples sorted by count descending.
        """
        text = self._get_all_text(job_id, include_comments=include_comments)
        words = self._tokenize(text, min_word_length=min_word_length)
        return Counter(words).most_common(top_n)

    def get_bigram_frequencies(
        self,
        job_id: int,
        top_n: int = 30,
        include_comments: bool = True,
    ) -> list[tuple[str, int]]:
        """Get top bigram (two-word phrase) frequencies.

        Args:
            job_id: The collection job to analyse.
            top_n: Number of top bigrams to return.
            include_comments: Whether to include comment text.

        Returns:
            List of ``("word1 word2", count)`` tuples sorted descending.
        """
        text = self._get_all_text(job_id, include_comments=include_comments)
        words = self._tokenize(text, min_word_length=3)
        bigrams: list[str] = []
        for i in range(len(words) - 1):
            bigrams.append(f"{words[i]} {words[i + 1]}")
        return Counter(bigrams).most_common(top_n)

    def get_temporal_distribution(
        self,
        job_id: int,
        interval: str = "day",
    ) -> list[dict]:
        """Get post count over time, grouped by interval.

        Args:
            job_id: The collection job to analyse.
            interval: One of ``"hour"``, ``"day"``, ``"week"``, ``"month"``.

        Returns:
            List of ``{"date": "2025-01-15", "count": 42}`` dicts sorted
            chronologically.
        """
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .all()
        )
        if not posts:
            return []

        bucket_counts: Counter[str] = Counter()
        for post in posts:
            try:
                dt = datetime.fromtimestamp(post.created_utc, tz=timezone.utc)
                key = self._bucket_key(dt, interval)
                bucket_counts[key] += 1
            except (ValueError, OSError):
                continue

        sorted_keys = sorted(bucket_counts.keys())
        return [{"date": k, "count": bucket_counts[k]} for k in sorted_keys]

    def get_keyword_trends(
        self,
        job_id: int,
        keywords: list[str],
        interval: str = "day",
    ) -> dict[str, list[dict]]:
        """Track specific keywords over time.

        For each keyword, counts how many posts (title + selftext) mention
        it per time bucket.

        Args:
            job_id: The collection job to analyse.
            keywords: Keywords to track (case-insensitive).
            interval: Time bucket size.

        Returns:
            ``{keyword: [{"date": "...", "count": N}, ...]}``
        """
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .all()
        )
        if not posts or not keywords:
            return {kw: [] for kw in keywords}

        # Normalise keywords
        keywords_lower = [kw.lower().strip() for kw in keywords]

        # Build per-keyword, per-bucket counters
        kw_buckets: dict[str, Counter[str]] = {
            kw: Counter() for kw in keywords_lower
        }

        for post in posts:
            try:
                dt = datetime.fromtimestamp(post.created_utc, tz=timezone.utc)
                bucket = self._bucket_key(dt, interval)
            except (ValueError, OSError):
                continue

            combined = f"{post.title} {post.selftext}".lower()
            for kw in keywords_lower:
                if kw in combined:
                    kw_buckets[kw][bucket] += 1

        # Collect all bucket keys across all keywords for consistent x-axis
        all_keys: set[str] = set()
        for counter in kw_buckets.values():
            all_keys.update(counter.keys())
        sorted_keys = sorted(all_keys)

        result: dict[str, list[dict]] = {}
        for kw in keywords_lower:
            result[kw] = [
                {"date": k, "count": kw_buckets[kw].get(k, 0)}
                for k in sorted_keys
            ]
        return result

    def get_author_stats(
        self,
        job_id: int,
        top_n: int = 20,
    ) -> list[dict]:
        """Get top authors by post count with stats.

        Args:
            job_id: The collection job to analyse.
            top_n: Number of top authors to return.

        Returns:
            List of dicts with keys ``author``, ``posts``, ``avg_score``,
            ``total_comments``.
        """
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .all()
        )
        if not posts:
            return []

        # Group posts by author
        author_posts: dict[str, list[CollectedPost]] = {}
        for post in posts:
            if post.author == "[deleted]":
                continue
            author_posts.setdefault(post.author, []).append(post)

        # Build stats per author
        author_list: list[dict] = []
        for author, a_posts in author_posts.items():
            scores = [p.score for p in a_posts]
            total_comments = sum(p.num_comments for p in a_posts)
            author_list.append({
                "author": author,
                "posts": len(a_posts),
                "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
                "total_comments": total_comments,
            })

        # Sort by post count desc, then by avg_score desc
        author_list.sort(key=lambda x: (-x["posts"], -x["avg_score"]))
        return author_list[:top_n]

    def get_engagement_stats(self, job_id: int) -> dict:
        """Get overall engagement statistics for a collection job.

        Args:
            job_id: The collection job to analyse.

        Returns:
            Dict with keys ``total_posts``, ``total_comments``, ``avg_score``,
            ``median_score``, ``avg_comments_per_post``, ``score_std_dev``,
            ``date_range``, ``unique_authors``.
        """
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .all()
        )

        comment_count = (
            self.db.query(CollectedComment)
            .filter(CollectedComment.job_id == job_id)
            .count()
        )

        if not posts:
            return {
                "total_posts": 0,
                "total_comments": comment_count,
                "avg_score": 0,
                "median_score": 0,
                "avg_comments_per_post": 0,
                "score_std_dev": 0,
                "date_range": {"start": None, "end": None},
                "unique_authors": 0,
            }

        scores = [p.score for p in posts]
        num_comments_list = [p.num_comments for p in posts]
        total = len(posts)

        # Mean
        avg_score = sum(scores) / total
        avg_comments = sum(num_comments_list) / total

        # Median
        sorted_scores = sorted(scores)
        mid = total // 2
        if total % 2 == 0:
            median_score = (sorted_scores[mid - 1] + sorted_scores[mid]) / 2
        else:
            median_score = sorted_scores[mid]

        # Standard deviation
        variance = sum((s - avg_score) ** 2 for s in scores) / total
        std_dev = math.sqrt(variance)

        # Date range
        timestamps = [p.created_utc for p in posts]
        min_ts = min(timestamps)
        max_ts = max(timestamps)
        try:
            start_dt = datetime.fromtimestamp(min_ts, tz=timezone.utc)
            end_dt = datetime.fromtimestamp(max_ts, tz=timezone.utc)
            date_start = start_dt.strftime("%Y-%m-%d")
            date_end = end_dt.strftime("%Y-%m-%d")
        except (ValueError, OSError):
            date_start = None
            date_end = None

        # Unique authors
        unique_authors = len({
            p.author for p in posts if p.author != "[deleted]"
        })

        return {
            "total_posts": total,
            "total_comments": comment_count,
            "avg_score": round(avg_score, 1),
            "median_score": round(median_score, 1),
            "avg_comments_per_post": round(avg_comments, 1),
            "score_std_dev": round(std_dev, 1),
            "date_range": {"start": date_start, "end": date_end},
            "unique_authors": unique_authors,
        }

    def get_score_distribution(self, job_id: int, bins: int = 20) -> list[dict]:
        """Get score distribution data for a histogram.

        Args:
            job_id: The collection job to analyse.
            bins: Number of histogram bins.

        Returns:
            List of ``{"range": "0-50", "count": N}`` dicts.
        """
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .all()
        )
        if not posts:
            return []

        scores = [p.score for p in posts]
        min_score = min(scores)
        max_score = max(scores)

        # Avoid division by zero if all scores are the same
        if min_score == max_score:
            return [{"range": str(min_score), "count": len(scores)}]

        bin_width = max(1, (max_score - min_score) / bins)
        histogram: list[dict] = []

        for i in range(bins):
            lo = min_score + i * bin_width
            hi = lo + bin_width
            if i == bins - 1:
                # Last bin includes upper edge
                count = sum(1 for s in scores if lo <= s <= hi)
            else:
                count = sum(1 for s in scores if lo <= s < hi)
            histogram.append({
                "range": f"{int(lo)}-{int(hi)}",
                "low": round(lo, 1),
                "high": round(hi, 1),
                "count": count,
            })

        return histogram

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _tokenize(
        self,
        text: str,
        min_word_length: int = 3,
    ) -> list[str]:
        """Tokenize text into lowercase words, removing punctuation and stopwords.

        Args:
            text: Raw text to tokenize.
            min_word_length: Minimum word length to keep.

        Returns:
            List of cleaned, lowercase tokens.
        """
        return [
            w
            for w in re.findall(r"\b[a-z]+\b", text.lower())
            if w not in self.STOPWORDS and len(w) >= min_word_length
        ]

    def _get_all_text(
        self,
        job_id: int,
        include_comments: bool = True,
    ) -> str:
        """Concatenate all text from a collection job.

        Collects post titles, self-texts, and optionally comment bodies.

        Args:
            job_id: The collection job ID.
            include_comments: Whether to include comment body text.

        Returns:
            Single concatenated string of all text.
        """
        posts = (
            self.db.query(CollectedPost)
            .filter(CollectedPost.job_id == job_id)
            .all()
        )

        parts: list[str] = []
        for post in posts:
            if post.title:
                parts.append(post.title)
            if post.selftext:
                parts.append(post.selftext)

        if include_comments:
            comments = (
                self.db.query(CollectedComment)
                .filter(CollectedComment.job_id == job_id)
                .all()
            )
            for comment in comments:
                if comment.body:
                    parts.append(comment.body)

        return " ".join(parts)

    @staticmethod
    def _bucket_key(dt: datetime, interval: str) -> str:
        """Convert a datetime to a bucket key string.

        Args:
            dt: The datetime to bucket.
            interval: One of ``"hour"``, ``"day"``, ``"week"``, ``"month"``.

        Returns:
            Bucket key string (e.g. ``"2025-01-15"`` for day).
        """
        if interval == "hour":
            return dt.strftime("%Y-%m-%d %H:00")
        elif interval == "week":
            # ISO week: use the Monday of the week
            monday = dt - __import__("datetime").timedelta(days=dt.weekday())
            return monday.strftime("%Y-%m-%d")
        elif interval == "month":
            return dt.strftime("%Y-%m")
        else:
            # Default: day
            return dt.strftime("%Y-%m-%d")
