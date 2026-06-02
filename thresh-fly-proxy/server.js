/**
 * thresh-fly-proxy — Reddit JSON proxy
 *
 * A tiny Node.js HTTP server deployed to Fly.io. It forwards requests
 * to Reddit's public JSON endpoints from an IP range that Reddit
 * doesn't block (unlike Cloudflare Workers' datacenter ranges).
 *
 * Sits behind the Cloudflare Pages Function (functions/api/reddit.js).
 * The Pages Function authenticates with PROXY_SECRET so this endpoint
 * isn't an open Reddit proxy for the world.
 *
 * Environment variables (set as Fly secrets):
 *   PROXY_SECRET — shared secret with the Cloudflare Pages Function
 */

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '8080', 10);
const PROXY_SECRET = process.env.PROXY_SECRET || '';
const USER_AGENT = 'web:com.the-threshing-floor:v1.1 (by /u/jethomasphd)';

const REDDIT_BASE = 'https://www.reddit.com';
const ALLOWED_PREFIXES = ['r/', 'search', 'subreddits/search', 'subreddits'];

function isAllowedPath(path) {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  // Simple health check (used by Fly's auto-start machinery)
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return json(res, 200, { ok: true, service: 'thresh-fly-proxy' });
  }

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  // Shared-secret auth: required if PROXY_SECRET is set.
  if (PROXY_SECRET) {
    const provided = req.headers['x-proxy-secret'];
    if (provided !== PROXY_SECRET) {
      return json(res, 403, { error: 'Forbidden' });
    }
  }

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return json(res, 400, { error: 'Bad request URL' });
  }

  let path = url.searchParams.get('path');
  if (!path) {
    return json(res, 400, { error: 'Missing "path" query parameter' });
  }

  // Normalize: strip leading slash; strip any .json suffix for the allow-check
  path = path.replace(/^\//, '');
  const pathForCheck = path.replace(/\.json($|\?)/, '$1');

  if (!isAllowedPath(pathForCheck)) {
    return json(res, 403, {
      error: 'Path not allowed. Must start with r/, search, or subreddits',
    });
  }

  // Ensure .json suffix so reddit.com returns JSON
  if (!path.includes('.json')) {
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) {
      path = path.substring(0, qIdx) + '.json' + path.substring(qIdx);
    } else {
      path = path + '.json';
    }
  }

  // Forward all client-provided query params except `path`. Add raw_json=1.
  const forwardParams = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key !== 'path') forwardParams.set(key, value);
  }
  forwardParams.set('raw_json', '1');

  const redditUrl = `${REDDIT_BASE}/${path}${
    path.includes('?') ? '&' : '?'
  }${forwardParams.toString()}`;

  try {
    const response = await fetch(redditUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    // Forward Reddit's rate-limit headers verbatim
    const passthroughHeaders = {
      'content-type': 'application/json; charset=utf-8',
    };
    for (const header of [
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'x-ratelimit-used',
      'retry-after',
    ]) {
      const val = response.headers.get(header);
      if (val !== null) passthroughHeaders[header] = val;
    }

    const text = await response.text();

    if (!response.ok) {
      const status = response.status;
      let message = 'Reddit returned an error';
      if (status === 404) message = 'Subreddit or resource not found';
      else if (status === 403)
        message = 'Access denied — this subreddit may be private or quarantined';
      else if (status === 429)
        message = 'Rate limited by Reddit. Please wait and try again.';
      else if (status >= 500)
        message = 'Reddit is experiencing issues. Try again shortly.';

      return json(res, status, { error: message, status }, passthroughHeaders);
    }

    res.writeHead(200, passthroughHeaders);
    res.end(text);
  } catch (err) {
    return json(res, 502, {
      error: 'Failed to reach Reddit',
      detail: (err.message || String(err)).slice(0, 300),
    });
  }
});

server.listen(PORT, () => {
  console.log(`thresh-fly-proxy listening on port ${PORT}`);
});
