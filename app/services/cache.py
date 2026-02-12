"""Simple SQLite-backed cache for Reddit API responses.

Uses a dedicated 'cache' table with TTL-based expiration.
Default TTL is 900 seconds (15 minutes) per CLAUDE.md requirements.
"""

import logging
import sqlite3
import time
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


class Cache:
    """SQLite-backed key-value cache with TTL expiration."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        """Initialize cache with a SQLite database path.

        Args:
            db_path: Path to the SQLite database. Defaults to settings.THRESH_DB_PATH.
        """
        if db_path is None:
            settings = get_settings()
            db_path = settings.THRESH_DB_PATH
        self._db_path = db_path
        self._ensure_table()

    def _get_connection(self) -> sqlite3.Connection:
        """Create a new database connection."""
        return sqlite3.connect(self._db_path)

    def _ensure_table(self) -> None:
        """Create the cache table if it does not exist."""
        conn = self._get_connection()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cache (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    expires_at REAL NOT NULL
                )
                """
            )
            conn.commit()
        except sqlite3.Error as e:
            logger.error(f"Failed to create cache table: {e}")
        finally:
            conn.close()

    def store(self, key: str, value: str, ttl_seconds: int = 900) -> None:
        """Store a value in the cache with a TTL.

        Args:
            key: Cache key.
            value: The string value to cache.
            ttl_seconds: Time-to-live in seconds (default 900 = 15 minutes).
        """
        expires_at = time.time() + ttl_seconds
        conn = self._get_connection()
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO cache (key, value, expires_at)
                VALUES (?, ?, ?)
                """,
                (key, value, expires_at),
            )
            conn.commit()
            logger.debug(f"Cached key '{key}' with TTL {ttl_seconds}s")
        except sqlite3.Error as e:
            logger.error(f"Failed to store cache key '{key}': {e}")
        finally:
            conn.close()

    def retrieve(self, key: str) -> Optional[str]:
        """Retrieve a value from the cache.

        Returns None if the key is missing or expired.

        Args:
            key: Cache key to look up.

        Returns:
            The cached string value, or None if not found/expired.
        """
        conn = self._get_connection()
        try:
            cursor = conn.execute(
                "SELECT value, expires_at FROM cache WHERE key = ?",
                (key,),
            )
            row = cursor.fetchone()
            if row is None:
                return None

            value, expires_at = row
            if time.time() > expires_at:
                # Entry has expired — clean it up
                conn.execute("DELETE FROM cache WHERE key = ?", (key,))
                conn.commit()
                logger.debug(f"Cache key '{key}' expired, removed")
                return None

            logger.debug(f"Cache hit for key '{key}'")
            return value
        except sqlite3.Error as e:
            logger.error(f"Failed to retrieve cache key '{key}': {e}")
            return None
        finally:
            conn.close()

    def clear_expired(self) -> int:
        """Remove all expired entries from the cache.

        Returns:
            Number of entries removed.
        """
        conn = self._get_connection()
        try:
            cursor = conn.execute(
                "DELETE FROM cache WHERE expires_at < ?",
                (time.time(),),
            )
            conn.commit()
            removed = cursor.rowcount
            if removed > 0:
                logger.info(f"Cleared {removed} expired cache entries")
            return removed
        except sqlite3.Error as e:
            logger.error(f"Failed to clear expired cache entries: {e}")
            return 0
        finally:
            conn.close()
