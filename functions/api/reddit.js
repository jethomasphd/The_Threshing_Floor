/**
 * Cloudflare Pages Function — Reddit JSON Proxy
 *
 * Proxies requests to Reddit's public JSON endpoints to avoid CORS restrictions.
 * No authentication required — uses Reddit's public .json endpoints.
 */

const REDDIT_BASE = 'https://www.reddit.com';
const USER_AGENT = 'ThreshingFloor/1.0 (Public Health Research Tool; Cloudflare Pages)';

// Allowed path prefixes to prevent arbitrary URL fetching
const ALLOWED_PREFIXES = [
  'r/',
  'search.json',
  'subreddits/search.json',
  'subreddits.json',
];

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

  // Strip leading slash if present
  path = path.replace(/^\//, '');

  // Validate the path
  if (!isAllowedPath(path)) {
    return new Response(
      JSON.stringify({ error: 'Path not allowed. Must start with r/, search.json, or subreddits/' }),
      { status: 403, headers: corsHeaders() }
    );
  }

  // Ensure .json suffix for Reddit endpoints that need it
  if (!path.includes('.json')) {
    // Add .json before query params if not present
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) {
      path = path.substring(0, qIdx) + '.json' + path.substring(qIdx);
    } else {
      path = path + '.json';
    }
  }

  // Forward additional query params from the original request
  const forwardParams = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key !== 'path') {
      forwardParams.set(key, value);
    }
  }

  // Build final Reddit URL
  let redditUrl = `${REDDIT_BASE}/${path}`;
  const forwardStr = forwardParams.toString();
  if (forwardStr) {
    redditUrl += (redditUrl.includes('?') ? '&' : '?') + forwardStr;
  }

  // Add raw_json=1 to get unescaped HTML entities
  redditUrl += (redditUrl.includes('?') ? '&' : '?') + 'raw_json=1';

  try {
    const response = await fetch(redditUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const status = response.status;
      let message = 'Reddit returned an error';

      if (status === 404) message = 'Subreddit or resource not found';
      else if (status === 403) message = 'Access denied — this subreddit may be private';
      else if (status === 429) message = 'Rate limited by Reddit. Please wait a moment and try again.';
      else if (status >= 500) message = 'Reddit is experiencing issues. Try again shortly.';

      const errorHeaders = corsHeaders();

      // Forward rate limit info on 429 so client can show countdown
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

    // Forward Reddit's rate limit headers so the client can track quota
    const responseHeaders = corsHeaders();
    const rlRemaining = response.headers.get('x-ratelimit-remaining');
    const rlReset = response.headers.get('x-ratelimit-reset');
    const rlUsed = response.headers.get('x-ratelimit-used');

    if (rlRemaining !== null) responseHeaders['X-RateLimit-Remaining'] = rlRemaining;
    if (rlReset !== null) responseHeaders['X-RateLimit-Reset'] = rlReset;
    if (rlUsed !== null) responseHeaders['X-RateLimit-Used'] = rlUsed;

    // Expose these headers to client-side JS
    responseHeaders['Access-Control-Expose-Headers'] = 'X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used';

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to reach Reddit. Check your connection.', detail: err.message }),
      { status: 502, headers: corsHeaders() }
    );
  }
}
