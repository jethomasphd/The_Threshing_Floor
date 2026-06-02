/**
 * The Threshing Floor — Reddit URL builder & paste parser (v2).
 *
 * v2 is human-in-the-loop. Reddit now blocks automated and datacenter-based
 * access to its public JSON endpoints, so The Threshing Floor no longer fetches
 * Reddit itself. Instead it builds the exact Reddit URL, the user opens it in
 * their own browser (a real person on a real connection — still allowed to read
 * public pages), copies the raw JSON, and pastes it back here. This module:
 *
 *   1. Builds the precise .json URLs (listings, search, comments).
 *   2. Parses pasted JSON into Thresh's internal post/comment shape, with
 *      friendly, specific errors when the wrong thing is pasted.
 *
 * The parsed shape is identical to what the old proxy produced, so everything
 * downstream (Harvest, Winnow, Glean, exports) is unchanged.
 */

const RedditClient = {
  BASE: 'https://www.reddit.com',
  MAX_PAGE: 100, // Reddit returns at most ~100 items per listing request

  // ---------------------------------------------------------------------------
  // URL building
  // ---------------------------------------------------------------------------

  /**
   * Normalize a user-typed subreddit field into a Reddit URL fragment.
   * Strips a leading "r/", trims, and converts spaces/commas into Reddit's
   * native multireddit "+" syntax so several subreddits resolve to ONE url.
   *   "science, AskScience"  ->  "science+AskScience"
   */
  normalizeSub(input) {
    return (input || '')
      .trim()
      .replace(/^\/?r\//i, '')      // drop a leading r/ or /r/
      .replace(/[\s,]+/g, '+')      // spaces & commas -> +
      .replace(/\++/g, '+')          // collapse repeats
      .replace(/^\+|\+$/g, '');     // trim stray +
  },

  /**
   * Reddit's search endpoint uses a different set of sort values than listings.
   * Map listing sorts onto the closest valid search sort.
   */
  _searchSort(sort) {
    switch (sort) {
      case 'top': return 'top';
      case 'new': return 'new';
      case 'hot': return 'hot';
      case 'controversial': return 'comments';
      case 'rising': return 'hot';
      default: return 'relevance';
    }
  },

  /**
   * Build the listing (or search) URL for the current page of a collection.
   *
   * @param {Object} config - { subreddit, sort, timeFilter, limit, keyword }
   * @param {Object} opts   - { after, pageLimit }
   * @returns {string} A fully-qualified reddit.com/...json URL
   */
  buildListingUrl(config, { after = null, pageLimit = null } = {}) {
    const sub = this.normalizeSub(config.subreddit);
    const limit = Math.min(pageLimit || config.limit || 25, this.MAX_PAGE);

    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('raw_json', '1'); // unescaped HTML entities, like the old proxy
    if (after) params.set('after', after);

    let path;
    if (config.keyword && config.keyword.trim()) {
      // Keyword search within the subreddit(s)
      path = `r/${sub}/search.json`;
      params.set('q', config.keyword.trim());
      params.set('restrict_sr', 'on');
      params.set('sort', this._searchSort(config.sort));
      params.set('t', config.timeFilter || 'all');
    } else {
      path = `r/${sub}/${config.sort || 'hot'}.json`;
      if (['top', 'controversial'].includes(config.sort)) {
        params.set('t', config.timeFilter || 'week');
      }
    }

    return `${this.BASE}/${path}?${params.toString()}`;
  },

  /**
   * Build the URL for a single post's comment thread.
   * @param {string} subreddit - The post's own subreddit (single, not a multireddit)
   * @param {string} postId    - The base-36 post id (e.g. "1abc2de")
   */
  buildCommentsUrl(subreddit, postId) {
    const sub = this.normalizeSub(subreddit);
    return `${this.BASE}/r/${sub}/comments/${postId}.json?limit=500&raw_json=1`;
  },

  // ---------------------------------------------------------------------------
  // Paste parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse pasted listing JSON (the posts step).
   * @returns {{ok:true, posts:Array, after:?string} | {ok:false, error:string}}
   */
  parseListingText(raw) {
    const text = (raw || '').trim();

    if (!text) {
      return { ok: false, error: 'Nothing was pasted yet. Copy the JSON from the Reddit tab, then paste it here.' };
    }
    if (text[0] === '<') {
      return { ok: false, error: 'That looks like a web page (HTML), not data. Make sure the address bar ends in “.json”, then select all the text it shows and copy it.' };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      const looksCut = !/[}\]]\s*$/.test(text);
      return {
        ok: false,
        error: looksCut
          ? 'The data looks cut off. Click into the Reddit tab, press Ctrl+A (Cmd+A on Mac) to select everything, copy, and paste again.'
          : 'That isn’t valid JSON. Make sure you opened the “.json” version of the page and copied the whole thing.',
      };
    }

    // Reddit error object (private/banned/quarantined/misspelled)
    if (data && !Array.isArray(data) && (data.error || data.reason) && !data.data) {
      const msg = data.message || data.reason || ('HTTP ' + data.error);
      return { ok: false, error: `Reddit returned an error: ${msg}. The subreddit may be private, quarantined, banned, or misspelled.` };
    }

    // A comments thread was pasted into the posts box by mistake
    if (Array.isArray(data)) {
      return { ok: false, error: 'That looks like a single post’s comments. For this step, open the listing link Thresh gave you (it ends in /top.json, /hot.json, /new.json, etc.).' };
    }

    const result = this._parseListing(data);
    if (!result.posts.length) {
      return { ok: false, error: 'No posts were found in that data. Double-check you copied a subreddit listing — not a single post, a user page, or a search box.' };
    }

    return { ok: true, posts: result.posts, after: result.after };
  },

  /**
   * Parse pasted comment-thread JSON (the optional per-post comments step).
   * Reddit's comment endpoint returns [postListing, commentListing].
   * @returns {{ok:true, comments:Array} | {ok:false, error:string}}
   */
  parseCommentsText(raw) {
    const text = (raw || '').trim();

    if (!text) return { ok: false, error: 'Nothing was pasted yet.' };
    if (text[0] === '<') {
      return { ok: false, error: 'That looks like a web page (HTML), not data. Use the “.json” comment link.' };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'That isn’t valid JSON. Select everything (Ctrl+A / Cmd+A) on the .json page and copy it again.' };
    }

    let commentListing = null;
    if (Array.isArray(data) && data.length >= 2) {
      commentListing = data[1]; // [post, comments]
    } else if (data && data.data && data.data.children) {
      commentListing = data; // someone pasted only the comment listing
    }

    if (!commentListing) {
      return { ok: false, error: 'That doesn’t look like a comments page. Open the post and add “.json” to the end of its address.' };
    }

    const comments = this._parseComments(commentListing);
    if (!comments.length) {
      return { ok: false, error: 'No comments were found (the post may have none, or they were collapsed/removed).' };
    }

    return { ok: true, comments };
  },

  // ---------------------------------------------------------------------------
  // Shape mappers (unchanged from v1 — the JSON is identical whether fetched
  // by a proxy or pasted by a human)
  // ---------------------------------------------------------------------------

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

// Exposed for any inline handlers / debugging
window.RedditClient = RedditClient;
