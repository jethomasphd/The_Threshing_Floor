/**
 * Reddit data fetching via Cloudflare Pages proxy.
 * No API key needed — uses Reddit's public JSON endpoints.
 */

const RedditClient = {
  PROXY_BASE: '/api/reddit',

  /**
   * Fetch JSON from Reddit via the proxy.
   * @param {string} path - Reddit path (e.g., "r/mentalhealth/hot")
   * @param {Object} params - Additional query params (limit, t, q, etc.)
   * @returns {Promise<Object>}
   */
  async fetch(path, params = {}) {
    const url = new URL(this.PROXY_BASE, window.location.origin);
    url.searchParams.set('path', path);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Reddit returned status ${response.status}`);
    }

    return data;
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
   * Get subreddit info.
   */
  async getSubredditAbout(subreddit) {
    const data = await this.fetch(`r/${subreddit}/about`);
    if (data && data.data) {
      const d = data.data;
      return {
        name: d.display_name,
        title: d.title,
        description: d.public_description || d.description,
        subscribers: d.subscribers,
        active_users: d.accounts_active,
        created_utc: d.created_utc,
        over18: d.over18,
      };
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
          } catch {
            // Some posts may not allow comment fetching
            posts[i].fetched_comments = [];
          }

          // Small delay to be respectful to Reddit
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // Delay between subreddits
      if (subreddits.length > 1) {
        await new Promise(r => setTimeout(r, 500));
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
