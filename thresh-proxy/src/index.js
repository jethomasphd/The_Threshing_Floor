/**
 * thresh-proxy — Cloudflare Worker
 *
 * A dedicated API proxy for The Threshing Floor.
 * Stores the Anthropic API key as a Cloudflare secret and proxies
 * requests to the Anthropic Messages API. End users never need
 * their own key.
 *
 * Secrets required:
 *   ANTHROPIC_API_KEY — Your Anthropic API key (set via `wrangler secret put ANTHROPIC_API_KEY`)
 *
 * Optional environment variables:
 *   ALLOWED_ORIGINS — Comma-separated list of allowed origins (default: allow all)
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 8192;

/**
 * Build CORS headers. If ALLOWED_ORIGINS is set, validate the request origin.
 * Otherwise, allow all origins (for public research tool use).
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';

  if (env.ALLOWED_ORIGINS) {
    const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    if (!allowed.includes(origin)) {
      return null; // Origin not allowed
    }
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

/**
 * Handle CORS preflight.
 */
function handleOptions(request, env) {
  const headers = corsHeaders(request, env);
  if (!headers) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(null, { status: 204, headers });
}

/**
 * Handle POST requests — proxy to Anthropic Messages API.
 */
async function handlePost(request, env) {
  const headers = corsHeaders(request, env);
  if (!headers) {
    return new Response(
      JSON.stringify({ error: 'Origin not allowed' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Verify the secret is configured
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Server misconfigured: API key not set' }),
      { status: 500, headers }
    );
  }

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers }
    );
  }

  const { messages, system } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Missing or empty messages array' }),
      { status: 400, headers }
    );
  }

  // Build the Anthropic request
  const anthropicBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages,
  };

  if (system) {
    anthropicBody.system = system;
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: data.error?.message || 'Anthropic API error',
          type: data.error?.type || 'api_error',
        }),
        { status: response.status, headers }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to reach Anthropic API', detail: err.message }),
      { status: 502, headers }
    );
  }
}

/**
 * Worker entry point.
 */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    if (request.method === 'POST') {
      return handlePost(request, env);
    }

    // Health check / info for GET requests
    const headers = corsHeaders(request, env) || { 'Content-Type': 'application/json' };
    return new Response(
      JSON.stringify({
        service: 'thresh-proxy',
        description: 'Anthropic API proxy for The Threshing Floor',
        model: MODEL,
        status: 'ok',
      }),
      { status: 200, headers }
    );
  },
};
