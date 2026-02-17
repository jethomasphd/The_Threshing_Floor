/**
 * Reddit data fetching via Cloudflare Pages proxy.
 * No API key needed — uses Reddit's public JSON endpoints.
 *
 * Includes rate limit tracking, subreddit metadata caching,
 * and exponential backoff on 429 responses.
 */

/**
 * Rate limit tracker — monitors Reddit API quota via response headers.
 * Persists state in localStorage so quota survives page reloads.
 */
const RateLimiter = {
  STORAGE_KEY: 'thresh_rate_limit',
  MAX_REQUESTS_PER_MINUTE: 100,

  // Internal state
  _remaining: 100,
  _resetAt: 0,        // Unix timestamp (seconds) when quota resets
  _used: 0,
  _lastUpdated: 0,
  _blocked: false,     // True when we've hit a 429
  _blockUntil: 0,      // Unix timestamp (ms) when block expires
  _listeners: [],      // UI callbacks

  init() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        this._remaining = state.remaining ?? 100;
        this._resetAt = state.resetAt ?? 0;
        this._used = state.used ?? 0;
        this._lastUpdated = state.lastUpdated ?? 0;
        this._blockUntil = state.blockUntil ?? 0;
      }
    } catch { /* fresh state */ }

    // If the reset window has passed, restore quota
    if (Date.now() / 1000 > this._resetAt) {
      this._remaining = this.MAX_REQUESTS_PER_MINUTE;
      this._used = 0;
      this._blocked = false;
      this._blockUntil = 0;
    }

    // Check if we're still in a block period
    this._blocked = Date.now() < this._blockUntil;
  },

  /**
   * Update state from Reddit response headers.
   */
  updateFromHeaders(headers) {
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');
    const used = headers.get('X-RateLimit-Used');

    if (remaining !== null) {
      this._remaining = Math.floor(parseFloat(remaining));
    }
    if (reset !== null) {
      // Reset is seconds until quota resets
      this._resetAt = (Date.now() / 1000) + parseFloat(reset);
    }
    if (used !== null) {
      this._used = parseInt(used, 10);
    }

    this._lastUpdated = Date.now();
    this._persist();
    this._notify();
  },

  /**
   * Record a 429 rate limit hit. Sets block period.
   */
  recordBlock(retryAfterSec) {
    const blockDuration = (retryAfterSec || 60) * 1000;
    this._blocked = true;
    this._blockUntil = Date.now() + blockDuration;
    this._remaining = 0;
    this._persist();
    this._notify();
  },

  /**
   * Clear the block (called when retry succeeds or block expires).
   */
  clearBlock() {
    this._blocked = false;
    this._blockUntil = 0;
    this._persist();
    this._notify();
  },

  /**
   * Check if requests are currently blocked.
   */
  isBlocked() {
    if (this._blocked && Date.now() >= this._blockUntil) {
      this.clearBlock();
      return false;
    }
    return this._blocked;
  },

  /**
   * Seconds remaining until the block expires.
   */
  blockSecondsLeft() {
    if (!this._blocked) return 0;
    return Math.max(0, Math.ceil((this._blockUntil - Date.now()) / 1000));
  },

  /**
   * Get current status for UI display.
   */
  getStatus() {
    // If reset window has passed, restore
    if (Date.now() / 1000 > this._resetAt && this._resetAt > 0) {
      this._remaining = this.MAX_REQUESTS_PER_MINUTE;
      this._used = 0;
      this._blocked = false;
    }

    return {
      remaining: this._remaining,
      used: this._used,
      max: this.MAX_REQUESTS_PER_MINUTE,
      percent: Math.round((this._remaining / this.MAX_REQUESTS_PER_MINUTE) * 100),
      blocked: this.isBlocked(),
      blockSecondsLeft: this.blockSecondsLeft(),
      resetAt: this._resetAt,
    };
  },

  /**
   * Register a listener for status changes.
   */
  onChange(callback) {
    this._listeners.push(callback);
  },

  _notify() {
    const status = this.getStatus();
    this._listeners.forEach(fn => fn(status));
  },

  _persist() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        remaining: this._remaining,
        resetAt: this._resetAt,
        used: this._used,
        lastUpdated: this._lastUpdated,
        blockUntil: this._blockUntil,
      }));
    } catch { /* localStorage full — non-critical */ }
  },
};

/**
 * Simple localStorage cache for subreddit metadata.
 * TTL: 15 minutes. Prevents redundant /about requests.
 */
const SubredditCache = {
  STORAGE_KEY: 'thresh_subreddit_cache',
  TTL_MS: 15 * 60 * 1000,

  _cache: {},

  init() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) this._cache = JSON.parse(saved);
    } catch {
      this._cache = {};
    }
    this._prune();
  },

  get(subreddit) {
    const key = subreddit.toLowerCase();
    const entry = this._cache[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > this.TTL_MS) {
      delete this._cache[key];
      this._persist();
      return null;
    }
    return entry.data;
  },

  set(subreddit, data) {
    const key = subreddit.toLowerCase();
    this._cache[key] = { data, ts: Date.now() };
    this._persist();
  },

  _prune() {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(this._cache)) {
      if (now - this._cache[key].ts > this.TTL_MS) {
        delete this._cache[key];
        changed = true;
      }
    }
    if (changed) this._persist();
  },

  _persist() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._cache));
    } catch { /* non-critical */ }
  },
};


const RedditClient = {
  PROXY_BASE: '/api/reddit',
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 600,      // Delay between requests (up from 200ms)
  SUBREDDIT_DELAY_MS: 1000, // Delay between subreddits (up from 500ms)

  /**
   * Fetch JSON from Reddit via the proxy.
   * Parses rate limit headers and retries on 429 with exponential backoff.
   *
   * @param {string} path - Reddit path (e.g., "r/mentalhealth/hot")
   * @param {Object} params - Additional query params (limit, t, q, etc.)
   * @returns {Promise<Object>}
   */
  async fetch(path, params = {}) {
    // Block if we're in a rate limit cooldown
    if (RateLimiter.isBlocked()) {
      const secs = RateLimiter.blockSecondsLeft();
      throw new Error(`Rate limited by Reddit. Please wait ${secs}s before trying again.`);
    }

    const url = new URL(this.PROXY_BASE, window.location.origin);
    url.searchParams.set('path', path);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    let lastError;
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s
        const backoff = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, backoff));

        // Re-check block status after waiting
        if (RateLimiter.isBlocked()) {
          const secs = RateLimiter.blockSecondsLeft();
          throw new Error(`Rate limited by Reddit. Please wait ${secs}s before trying again.`);
        }
      }

      const response = await fetch(url.toString());

      // Update rate limit state from headers (even on errors)
      RateLimiter.updateFromHeaders(response.headers);

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const resetSec = retryAfter ? parseInt(retryAfter, 10) : 60;
        RateLimiter.recordBlock(resetSec);

        const data = await response.json().catch(() => ({}));
        lastError = new Error(data.error || `Rate limited by Reddit. Retrying in ${Math.pow(2, attempt + 1)}s...`);
        continue;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Reddit returned status ${response.status}`);
      }

      // If we recovered from a previous 429, clear the block
      if (attempt > 0) {
        RateLimiter.clearBlock();
      }

      return data;
    }

    // All retries exhausted
    throw lastError || new Error('Rate limited by Reddit. Please wait and try again.');
  },

  /**
   * Get posts from a subreddit.
   */
  async getPosts(subreddit, { sort = 'hot', timeFilter = 'week', limit = 25, after = null } = {}) {
    const path = `r/${subreddit}/${sort}`;
    const params = { limit };

    if (['top', 'controversial'].includes(sort)) {
      params.t = timeFilter;
    }
    if (after) {
      params.after = after;
    }

    const data = await this.fetch(path, params);
    return this._parseListing(data);
  },

  /**
   * Search posts within a subreddit.
   */
  async searchPosts(subreddit, query, { sort = 'relevance', timeFilter = 'all', limit = 25 } = {}) {
    const path = `r/${subreddit}/search`;
    const params = {
      q: query,
      restrict_sr: 'on',
      sort,
      t: timeFilter,
      limit,
    };

    const data = await this.fetch(path, params);
    return this._parseListing(data);
  },

  /**
   * Get comments for a post.
   */
  async getComments(subreddit, postId) {
    const path = `r/${subreddit}/comments/${postId}`;
    const data = await this.fetch(path, { limit: 50, depth: 2 });

    // Reddit returns [post_listing, comment_listing]
    if (!Array.isArray(data) || data.length < 2) {
      return [];
    }

    return this._parseComments(data[1]);
  },

  /**
   * Get subreddit info (cached for 15 minutes).
   */
  async getSubredditAbout(subreddit) {
    // Check cache first
    const cached = SubredditCache.get(subreddit);
    if (cached) return cached;

    const data = await this.fetch(`r/${subreddit}/about`);
    if (data && data.data) {
      const d = data.data;
      const result = {
        name: d.display_name,
        title: d.title,
        description: d.public_description || d.description,
        subscribers: d.subscribers,
        active_users: d.accounts_active,
        created_utc: d.created_utc,
        over18: d.over18,
      };
      SubredditCache.set(subreddit, result);
      return result;
    }
    return null;
  },

  /**
   * Collect posts, optionally with pagination and comments.
   * Yields progress updates via callback.
   */
  async collect(config, onProgress) {
    const {
      subreddit,
      sort = 'hot',
      timeFilter = 'week',
      limit = 25,
      keyword = '',
      includeComments = false,
    } = config;

    // Pre-flight: check if we're blocked
    if (RateLimiter.isBlocked()) {
      const secs = RateLimiter.blockSecondsLeft();
      throw new Error(`Rate limited by Reddit. Please wait ${secs} seconds before collecting.`);
    }

    // Warn if quota is very low
    const status = RateLimiter.getStatus();
    const estimatedRequests = this._estimateRequests(config);
    if (status.remaining < estimatedRequests && status.remaining < 20) {
      onProgress?.({
        message: `Warning: low API quota (${status.remaining} remaining). Collection may be interrupted.`,
        current: 0,
        total: limit,
      });
      await new Promise(r => setTimeout(r, 1500));
    }

    const subreddits = subreddit.split(',').map(s => s.trim()).filter(Boolean);
    const allPosts = [];
    const allComments = [];
    let totalFetched = 0;

    for (const sub of subreddits) {
      onProgress?.({
        message: `Fetching posts from r/${sub}...`,
        current: totalFetched,
        total: limit * subreddits.length,
      });

      let posts;
      if (keyword) {
        const result = await this.searchPosts(sub, keyword, { sort, timeFilter, limit });
        posts = result.posts;
      } else {
        const result = await this.getPosts(sub, { sort, timeFilter, limit });
        posts = result.posts;
      }

      // Add subreddit field to each post
      posts.forEach(p => { p.subreddit = sub; });

      totalFetched += posts.length;
      allPosts.push(...posts);

      onProgress?.({
        message: `Collected ${posts.length} posts from r/${sub}`,
        current: totalFetched,
        total: limit * subreddits.length,
      });

      // Collect comments if requested
      if (includeComments) {
        for (let i = 0; i < posts.length; i++) {
          onProgress?.({
            message: `Fetching comments for post ${i + 1}/${posts.length} in r/${sub}...`,
            current: totalFetched,
            total: limit * subreddits.length,
          });

          try {
            const comments = await this.getComments(sub, posts[i].id);
            posts[i].fetched_comments = comments;
            allComments.push(...comments.map(c => ({ ...c, post_id: posts[i].id })));
          } catch (err) {
            // If rate limited during comment fetching, stop gracefully
            if (err.message.includes('Rate limited')) {
              onProgress?.({
                message: `Rate limited — stopping comment collection. ${allPosts.length} posts saved.`,
                current: totalFetched,
                total: limit * subreddits.length,
              });
              break;
            }
            // Other errors: skip this post's comments
            posts[i].fetched_comments = [];
          }

          // Respectful delay between comment fetches
          await new Promise(r => setTimeout(r, this.BASE_DELAY_MS));
        }
      }

      // Delay between subreddits
      if (subreddits.length > 1) {
        await new Promise(r => setTimeout(r, this.SUBREDDIT_DELAY_MS));
      }
    }

    return {
      posts: allPosts,
      comments: allComments,
      config,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Estimate the number of API requests a collection will make.
   */
  _estimateRequests(config) {
    const subreddits = config.subreddit.split(',').filter(Boolean).length;
    // 1 request per subreddit for posts, +1 per post for comments
    let estimate = subreddits;
    if (config.includeComments) {
      estimate += config.limit * subreddits;
    }
    return estimate;
  },

  /**
   * Parse a Reddit listing response into posts.
   */
  _parseListing(data) {
    if (!data || !data.data || !data.data.children) {
      return { posts: [], after: null };
    }

    const posts = data.data.children
      .filter(child => child.kind === 't3')
      .map(child => {
        const d = child.data;
        return {
          id: d.id,
          reddit_id: d.name,
          title: d.title,
          author: d.author,
          selftext: d.selftext || '',
          score: d.score,
          upvote_ratio: d.upvote_ratio,
          num_comments: d.num_comments,
          created_utc: d.created_utc,
          url: d.url,
          permalink: `https://reddit.com${d.permalink}`,
          is_self: d.is_self,
          link_flair_text: d.link_flair_text || '',
          subreddit: d.subreddit,
          domain: d.domain,
          over_18: d.over_18,
        };
      });

    return {
      posts,
      after: data.data.after,
    };
  },

  /**
   * Parse comment listing into flat array.
   */
  _parseComments(listing) {
    if (!listing || !listing.data || !listing.data.children) return [];

    const comments = [];

    const processComment = (child, depth = 0) => {
      if (child.kind !== 't1' || !child.data) return;
      const d = child.data;

      comments.push({
        id: d.id,
        author: d.author,
        body: d.body || '',
        score: d.score,
        created_utc: d.created_utc,
        depth,
        parent_id: d.parent_id,
      });

      // Process replies
      if (d.replies && d.replies.data && d.replies.data.children) {
        d.replies.data.children.forEach(reply => processComment(reply, depth + 1));
      }
    };

    listing.data.children.forEach(child => processComment(child));
    return comments;
  },
};

// Initialize on load
RateLimiter.init();
SubredditCache.init();
