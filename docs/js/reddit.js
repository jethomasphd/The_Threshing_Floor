/**
 * Reddit API client — OAuth2 implicit flow + oauth.reddit.com (CORS-enabled).
 *
 * Usage flow:
 *   1. User creates a Reddit "web app" at https://www.reddit.com/prefs/apps
 *   2. Sets redirect URI to their GitHub Pages URL
 *   3. Enters client ID in the app
 *   4. Clicks Connect → redirected to Reddit → back with token
 *   5. All API calls go to oauth.reddit.com with the token
 */
'use strict';

window.Thresh = window.Thresh || {};

Thresh.Reddit = (function () {
  const OAUTH_BASE = 'https://oauth.reddit.com';
  const AUTH_URL = 'https://www.reddit.com/api/v1/authorize';
  const SCOPES = 'read';
  const TOKEN_KEY = 'thresh_reddit_token';
  const TOKEN_EXPIRY_KEY = 'thresh_reddit_token_expiry';
  const CLIENT_ID_KEY = 'thresh_reddit_client_id';

  /* ---------- Rate Limiter ---------- */
  const rateLimiter = {
    remaining: 60,
    resetTime: 0,
    used: 0,

    /** Update from reddit response headers. */
    update(headers) {
      const rem = headers.get('x-ratelimit-remaining');
      const reset = headers.get('x-ratelimit-reset');
      if (rem !== null) this.remaining = Math.floor(parseFloat(rem));
      if (reset !== null) this.resetTime = Date.now() + parseInt(reset, 10) * 1000;
      this.used++;
    },

    canRequest() {
      if (this.remaining <= 1 && Date.now() < this.resetTime) return false;
      return true;
    },

    getStatus() {
      return {
        remaining: this.remaining,
        used: this.used,
        resetTime: this.resetTime,
        pct: Math.max(0, Math.min(100, (this.remaining / 60) * 100)),
      };
    },
  };

  /* ---------- Token helpers ---------- */
  function getToken() {
    const expiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
    if (Date.now() > expiry) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
      return null;
    }
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token, expiresIn) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  }

  function getClientId() {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  }

  function setClientId(id) {
    localStorage.setItem(CLIENT_ID_KEY, id.trim());
  }

  function isConnected() {
    return !!getToken();
  }

  /** Build the OAuth authorize URL and redirect the user. */
  function authorize() {
    const clientId = getClientId();
    if (!clientId) throw new Error('Set your Reddit client ID first.');
    const redirectUri = window.location.origin + window.location.pathname;
    const state = Math.random().toString(36).substring(2);
    sessionStorage.setItem('thresh_oauth_state', state);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'token',
      state: state,
      redirect_uri: redirectUri,
      scope: SCOPES,
      duration: 'temporary',
    });
    window.location.href = AUTH_URL + '?' + params.toString();
  }

  /** Called on page load to capture token from URL fragment. */
  function handleCallback() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return false;

    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('access_token');
    const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
    const state = params.get('state');
    const savedState = sessionStorage.getItem('thresh_oauth_state');

    if (state && savedState && state !== savedState) {
      console.warn('OAuth state mismatch — ignoring callback.');
      return false;
    }

    if (token) {
      setToken(token, expiresIn);
      sessionStorage.removeItem('thresh_oauth_state');
      // Clean the URL fragment so it doesn't persist
      history.replaceState(null, '', window.location.pathname);
      return true;
    }
    return false;
  }

  /* ---------- Fetch wrapper ---------- */
  async function apiFetch(endpoint, params) {
    const token = getToken();
    if (!token) throw new Error('Not connected to Reddit. Please connect first.');
    if (!rateLimiter.canRequest()) throw new Error('Rate limit reached. Please wait a moment.');

    const url = new URL(endpoint, OAUTH_BASE);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: 'Bearer ' + token,
        'User-Agent': 'web:thresh:v0.1.0',
      },
    });

    rateLimiter.update(resp.headers);

    if (resp.status === 401) {
      clearToken();
      throw new Error('Reddit session expired. Please reconnect.');
    }
    if (resp.status === 403) {
      throw new Error('Access denied. The subreddit may be private or quarantined.');
    }
    if (resp.status === 404) {
      throw new Error('Not found. Check that the subreddit name is correct.');
    }
    if (!resp.ok) {
      throw new Error('Reddit API error: ' + resp.status);
    }
    return resp.json();
  }

  /* ---------- Public API ---------- */

  /** Search for subreddits by query. */
  async function searchSubreddits(query, limit) {
    limit = Math.min(limit || 10, 25);
    const data = await apiFetch('/subreddits/search', { q: query, limit, include_over_18: false });
    return (data.data.children || []).map(function (c) {
      const s = c.data;
      return {
        name: s.display_name,
        title: s.title || s.display_name,
        subscribers: s.subscribers || 0,
        description: s.public_description || '',
        over18: s.over18 || false,
        icon: s.icon_img || s.community_icon || '',
        created: s.created_utc,
      };
    });
  }

  /** Get detailed info about a subreddit. */
  async function getSubredditAbout(name) {
    const data = await apiFetch('/r/' + encodeURIComponent(name) + '/about');
    const s = data.data;
    return {
      name: s.display_name,
      title: s.title,
      subscribers: s.subscribers || 0,
      activeUsers: s.accounts_active || 0,
      description: s.public_description || '',
      fullDescription: s.description || '',
      over18: s.over18 || false,
      created: s.created_utc,
    };
  }

  /** Fetch posts from a subreddit. */
  async function getPosts(subreddit, sort, timeFilter, limit, query) {
    sort = sort || 'hot';
    limit = Math.min(limit || 25, 100);

    let endpoint, params;
    if (query) {
      endpoint = '/r/' + encodeURIComponent(subreddit) + '/search';
      params = { q: query, sort, t: timeFilter || 'all', limit, restrict_sr: 'on' };
    } else {
      endpoint = '/r/' + encodeURIComponent(subreddit) + '/' + sort;
      params = { limit };
      if ((sort === 'top' || sort === 'controversial') && timeFilter) {
        params.t = timeFilter;
      }
    }

    const data = await apiFetch(endpoint, params);
    return (data.data.children || []).map(function (c) {
      const p = c.data;
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

  /** Fetch comments for a post. */
  async function getComments(postId, subreddit, depth, limit) {
    depth = depth || 3;
    limit = Math.min(limit || 50, 200);
    const data = await apiFetch(
      '/r/' + encodeURIComponent(subreddit) + '/comments/' + postId,
      { depth, limit, sort: 'best' }
    );

    // Reddit returns [post_listing, comment_listing]
    const commentListing = data[1];
    if (!commentListing || !commentListing.data) return [];

    function flatten(children) {
      const out = [];
      for (const c of children) {
        if (c.kind !== 't1') continue;
        const d = c.data;
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
    // OAuth
    getClientId: getClientId,
    setClientId: setClientId,
    authorize: authorize,
    handleCallback: handleCallback,
    isConnected: isConnected,
    clearToken: clearToken,

    // API
    searchSubreddits: searchSubreddits,
    getSubredditAbout: getSubredditAbout,
    getPosts: getPosts,
    getComments: getComments,

    // Rate limit
    getRateLimit: function () { return rateLimiter.getStatus(); },
  };
})();
