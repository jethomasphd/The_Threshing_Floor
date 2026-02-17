/**
 * Cloudflare Pages Function — Claude API Proxy
 *
 * Proxies requests to the Anthropic API so users can leverage Claude
 * for analysis without CORS issues. The user provides their own API key.
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  const { apiKey, messages, system } = body;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing apiKey in request body' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Missing or empty messages array' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  try {
    const anthropicBody = {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages,
    };

    if (system) {
      anthropicBody.system = system;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: data.error?.message || 'Claude API error',
          type: data.error?.type || 'api_error',
        }),
        { status: response.status, headers: corsHeaders() }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to reach Claude API', detail: err.message }),
      { status: 502, headers: corsHeaders() }
    );
  }
}
