/**
 * Reddit scraper — fetches public JSON from reddit.com via CORS proxy.
 *
 * No API keys. No OAuth. No setup.
 * Reddit serves JSON at any URL + ".json". A lightweight CORS proxy
 * relays these requests so the browser can read them.
 */
'use strict';

window.Thresh = window.Thresh || {};

Thresh.Reddit = (function () {
  const REDDIT = 'https://www.reddit.com';
  const PROXY_KEY = 'thresh_cors_proxy';

  /* Built-in proxy list — tried in order until one works. */
  const DEFAULT_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
  ];

  /* ---------- Rate Limiter ---------- */
  /* Reddit allows ~10 unauthenticated req/min. We track locally. */
  const rateLimiter = {
    timestamps: [],
    MAX_PER_MIN: 10,

    canRequest() {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(function (t) { return now - t < 60000; });
      return this.timestamps.length < this.MAX_PER_MIN;
    },

    record() {
      this.timestamps.push(Date.now());
    },

    getStatus() {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(function (t) { return now - t < 60000; });
      var remaining = Math.max(0, this.MAX_PER_MIN - this.timestamps.length);
      return {
        remaining: remaining,
        used: this.timestamps.length,
        pct: (remaining / this.MAX_PER_MIN) * 100,
      };
    },
  };

  /* ---------- Proxy helpers ---------- */

  function getProxy() {
    return localStorage.getItem(PROXY_KEY) || DEFAULT_PROXIES[0];
  }

  function setProxy(url) {
    localStorage.setItem(PROXY_KEY, url.trim());
  }

  /**
   * Fetch JSON from a Reddit URL, trying proxies in order.
   * On the first successful proxy, cache it for future calls.
   */
  async function fetchJSON(redditUrl) {
    if (!rateLimiter.canRequest()) {
      var s = rateLimiter.getStatus();
      throw new Error('Rate limit reached (' + s.used + '/' + rateLimiter.MAX_PER_MIN +
        ' in the last minute). Wait a few seconds and try again.');
    }

    // Try direct fetch first (works if user has a CORS extension or Reddit adds headers)
    try {
      var directResp = await fetch(redditUrl, { signal: AbortSignal.timeout(5000) });
      if (directResp.ok) {
        rateLimiter.record();
        return directResp.json();
      }
    } catch (_e) {
      // Expected — CORS block. Fall through to proxy.
    }

    // Try saved proxy first, then fallbacks
    var saved = localStorage.getItem(PROXY_KEY);
    var proxyOrder = saved ? [saved] : DEFAULT_PROXIES.slice();
    // Add any we haven't tried
    for (var i = 0; i < DEFAULT_PROXIES.length; i++) {
      if (proxyOrder.indexOf(DEFAULT_PROXIES[i]) === -1) proxyOrder.push(DEFAULT_PROXIES[i]);
    }

    var lastError = null;
    for (var j = 0; j < proxyOrder.length; j++) {
      var proxy = proxyOrder[j];
      try {
        var resp = await fetch(proxy + encodeURIComponent(redditUrl), {
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          rateLimiter.record();
          // Remember working proxy
          localStorage.setItem(PROXY_KEY, proxy);
          return resp.json();
        }
        lastError = new Error('Proxy returned ' + resp.status);
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(
      'Could not reach Reddit. All CORS proxies failed. ' +
      'You can set a custom proxy on the About page. (' +
      (lastError ? lastError.message : 'unknown error') + ')'
    );
  }

  /* ---------- Build Reddit JSON URLs ---------- */

  function redditURL(path, params) {
    var url = REDDIT + path + '.json';
    if (params) {
      var qs = [];
      for (var k in params) {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
          qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      // Add raw_json=1 so Reddit returns actual characters instead of HTML entities
      qs.push('raw_json=1');
      if (qs.length) url += '?' + qs.join('&');
    } else {
      url += '?raw_json=1';
    }
    return url;
  }

  /* ---------- Public API ---------- */

  async function searchSubreddits(query, limit) {
    limit = Math.min(limit || 10, 25);
    var url = redditURL('/subreddits/search', { q: query, limit: limit, include_over_18: 'false' });
    var data = await fetchJSON(url);
    return (data.data.children || []).map(function (c) {
      var s = c.data;
      return {
        name: s.display_name,
        title: s.title || s.display_name,
        subscribers: s.subscribers || 0,
        description: s.public_description || '',
        over18: s.over18 || false,
        created: s.created_utc,
      };
    });
  }

  async function getSubredditAbout(name) {
    var url = redditURL('/r/' + encodeURIComponent(name) + '/about');
    var data = await fetchJSON(url);
    var s = data.data;
    return {
      name: s.display_name,
      title: s.title,
      subscribers: s.subscribers || 0,
      activeUsers: s.accounts_active || 0,
      description: s.public_description || '',
      over18: s.over18 || false,
      created: s.created_utc,
    };
  }

  async function getPosts(subreddit, sort, timeFilter, limit, query) {
    sort = sort || 'hot';
    limit = Math.min(limit || 25, 100);

    var path, params;
    if (query) {
      path = '/r/' + encodeURIComponent(subreddit) + '/search';
      params = { q: query, sort: sort, t: timeFilter || 'all', limit: limit, restrict_sr: 'on' };
    } else {
      path = '/r/' + encodeURIComponent(subreddit) + '/' + sort;
      params = { limit: limit };
      if ((sort === 'top' || sort === 'controversial') && timeFilter) {
        params.t = timeFilter;
      }
    }

    var data = await fetchJSON(redditURL(path, params));
    return (data.data.children || []).map(function (c) {
      var p = c.data;
      return {
        id: p.id,
        title: p.title,
        author: p.author || '[deleted]',
        score: p.score,
        upvoteRatio: p.upvote_ratio,
        numComments: p.num_comments,
        created: p.created_utc,
        selftext: p.selftext || '',
        url: p.url,
        permalink: 'https://www.reddit.com' + p.permalink,
        isVideo: p.is_video || false,
        isSelf: p.is_self || false,
        flair: p.link_flair_text || '',
        subreddit: p.subreddit,
      };
    });
  }

  async function getComments(postId, subreddit, depth, limit) {
    depth = depth || 3;
    limit = Math.min(limit || 50, 200);
    var url = redditURL(
      '/r/' + encodeURIComponent(subreddit) + '/comments/' + postId,
      { depth: depth, limit: limit, sort: 'best' }
    );
    var data = await fetchJSON(url);

    var commentListing = data[1];
    if (!commentListing || !commentListing.data) return [];

    function flatten(children) {
      var out = [];
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c.kind !== 't1') continue;
        var d = c.data;
        out.push({
          id: d.id,
          author: d.author || '[deleted]',
          body: d.body || '',
          score: d.score,
          created: d.created_utc,
          parentId: d.parent_id,
          depth: d.depth || 0,
        });
        if (d.replies && d.replies.data && d.replies.data.children) {
          out.push.apply(out, flatten(d.replies.data.children));
        }
      }
      return out;
    }

    return flatten(commentListing.data.children || []);
  }

  return {
    searchSubreddits: searchSubreddits,
    getSubredditAbout: getSubredditAbout,
    getPosts: getPosts,
    getComments: getComments,
    getRateLimit: function () { return rateLimiter.getStatus(); },
    getProxy: getProxy,
    setProxy: setProxy,
  };
})();
