/**
 * Cloudflare Pages Function — Reddit OAuth Proxy
 *
 * Proxies requests to Reddit's OAuth API (oauth.reddit.com) using app-only
 * authentication (the client_credentials grant). This avoids the IP-based
 * blocking Reddit applies to anonymous requests originating from datacenter
 * IP ranges (including Cloudflare's), which previously caused 403 responses
 * for every subreddit.
 *
 * End users still bring no credentials — the operator (site owner) registers
 * a single Reddit app and stores its client ID/secret as Cloudflare Pages
 * secrets. See functions/api/SETUP.md for setup instructions.
 *
 * Required Cloudflare Pages secrets:
 *   REDDIT_CLIENT_ID     — Reddit app client ID
 *   REDDIT_CLIENT_SECRET — Reddit app client secret
 */

const REDDIT_OAUTH_BASE = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const USER_AGENT = 'web:com.the-threshing-floor:v1.1 (by /u/jethomasphd)';

// Allowed path prefixes (post-`.json`-strip) to prevent arbitrary URL fetching.
const ALLOWED_PREFIXES = ['r/', 'search', 'subreddits/search', 'subreddits'];

function isAllowedPath(path) {
  return ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

// Per-isolate token cache. Multiple isolates may each fetch their own token
// on cold start — that's fine; each token is good for ~1 hour.
let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAccessToken(env, forceRefresh = false) {
  if (!forceRefresh && _cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const clientId = env.REDDIT_CLIENT_ID;
  const clientSecret = env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const err = new Error('OAUTH_NOT_CONFIGURED');
    err.code = 'OAUTH_NOT_CONFIGURED';
    throw err;
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`Token fetch failed (${response.status}): ${body.slice(0, 200)}`);
    err.code = 'TOKEN_FETCH_FAILED';
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  if (!data.access_token) {
    const err = new Error('Token endpoint returned no access_token');
    err.code = 'TOKEN_FETCH_FAILED';
    throw err;
  }

  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  return _cachedToken;
}

function buildRedditUrl(path, forwardParams) {
  // Strip trailing .json — oauth.reddit.com endpoints don't use it.
  const cleanedPath = path.replace(/\.json($|\?)/, '$1');
  const qs = forwardParams.toString();
  return `${REDDIT_OAUTH_BASE}/${cleanedPath}${qs ? (cleanedPath.includes('?') ? '&' : '?') + qs : ''}`;
}

async function callReddit(redditUrl, token) {
  return fetch(redditUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  let path = url.searchParams.get('path');

  if (!path) {
    return new Response(
      JSON.stringify({ error: 'Missing "path" query parameter' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  // Normalize: strip leading slash and any .json suffix for the allow-check
  path = path.replace(/^\//, '');
  const pathForCheck = path.replace(/\.json($|\?)/, '$1');

  if (!isAllowedPath(pathForCheck)) {
    return new Response(
      JSON.stringify({ error: 'Path not allowed. Must start with r/, search, or subreddits' }),
      { status: 403, headers: corsHeaders() }
    );
  }

  // Forward all query params except `path`. Add raw_json=1 for unescaped HTML.
  const forwardParams = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key !== 'path') forwardParams.set(key, value);
  }
  forwardParams.set('raw_json', '1');

  const redditUrl = buildRedditUrl(path, forwardParams);

  // Fetch token (cached if fresh)
  let token;
  try {
    token = await getAccessToken(context.env);
  } catch (err) {
    if (err.code === 'OAUTH_NOT_CONFIGURED') {
      return new Response(
        JSON.stringify({
          error: 'Reddit OAuth is not configured on this deployment. The site operator must set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET as Cloudflare Pages secrets. See functions/api/SETUP.md.',
        }),
        { status: 500, headers: corsHeaders() }
      );
    }
    return new Response(
      JSON.stringify({ error: 'Could not authenticate with Reddit. Try again shortly.', detail: (err.message || '').slice(0, 300) }),
      { status: 502, headers: corsHeaders() }
    );
  }

  try {
    let response = await callReddit(redditUrl, token);

    // If the token is rejected, force a refresh and retry once.
    if (response.status === 401) {
      try {
        token = await getAccessToken(context.env, /* forceRefresh */ true);
        response = await callReddit(redditUrl, token);
      } catch (err) {
        return new Response(
          JSON.stringify({ error: 'Reddit authentication failed.', detail: (err.message || '').slice(0, 300) }),
          { status: 502, headers: corsHeaders() }
        );
      }
    }

    if (!response.ok) {
      const status = response.status;
      let message = 'Reddit returned an error';

      if (status === 404) message = 'Subreddit or resource not found';
      else if (status === 403) message = 'Access denied — this subreddit may be private or quarantined';
      else if (status === 429) message = 'Rate limited by Reddit. Please wait a moment and try again.';
      else if (status >= 500) message = 'Reddit is experiencing issues. Try again shortly.';

      const errorHeaders = corsHeaders();
      if (status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const rlReset = response.headers.get('x-ratelimit-reset');
        if (retryAfter) errorHeaders['Retry-After'] = retryAfter;
        if (rlReset) errorHeaders['X-RateLimit-Reset'] = rlReset;
        errorHeaders['X-RateLimit-Remaining'] = '0';
        errorHeaders['Access-Control-Expose-Headers'] = 'Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset';
      }

      return new Response(
        JSON.stringify({ error: message, status }),
        { status, headers: errorHeaders }
      );
    }

    const data = await response.json();

    const responseHeaders = corsHeaders();
    const rlRemaining = response.headers.get('x-ratelimit-remaining');
    const rlReset = response.headers.get('x-ratelimit-reset');
    const rlUsed = response.headers.get('x-ratelimit-used');

    if (rlRemaining !== null) responseHeaders['X-RateLimit-Remaining'] = rlRemaining;
    if (rlReset !== null) responseHeaders['X-RateLimit-Reset'] = rlReset;
    if (rlUsed !== null) responseHeaders['X-RateLimit-Used'] = rlUsed;

    responseHeaders['Access-Control-Expose-Headers'] = 'X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used';

    return new Response(JSON.stringify(data), { status: 200, headers: responseHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to reach Reddit. Check your connection.', detail: err.message }),
      { status: 502, headers: corsHeaders() }
    );
  }
}
