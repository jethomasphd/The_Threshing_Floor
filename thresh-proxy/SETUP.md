# thresh-proxy — Setup Guide

This Cloudflare Worker serves as the AI proxy for The Threshing Floor. It is deployed at `api.the-threshing-floor.com` and stores the Anthropic API key as a server-side encrypted secret. End users never need their own key.

## Production Deployment

The worker is live at:
- **Custom domain**: `https://api.the-threshing-floor.com`
- **Worker URL**: `https://thresh-proxy.jethomasphd.workers.dev`

The client-side code (`public/js/claude.js`) points to `https://api.the-threshing-floor.com`.

## Architecture

```
User's Browser                thresh-proxy Worker              Anthropic API
     |                              |                              |
     |-- POST {messages, system} -->|                              |
     |                              |-- adds ANTHROPIC_API_KEY  -->|
     |                              |   from Cloudflare secret     |
     |                              |<-- Claude response ----------|
     |<-- proxied response ---------|                              |
```

- The worker stores the API key as a **Cloudflare Secret** — encrypted at rest, never visible in logs or dashboards
- Requests are validated (must include `messages` array)
- CORS headers are set for browser access
- The model is set to `claude-opus-4-6` (Anthropic's most capable model) with 8192 max tokens
- GET requests return a health check JSON response

## Model

The worker uses **Claude Opus 4.6** (`claude-opus-4-6`), Anthropic's most capable model. This produces the highest-quality research reports and analysis. To change the model, edit the `MODEL` constant in `src/index.js`.

## Secrets & Variables

| Name | Type | Value |
|------|------|-------|
| `ANTHROPIC_API_KEY` | Secret (encrypted) | Your `sk-ant-...` Anthropic API key |
| `ALLOWED_ORIGINS` | Environment variable (optional) | Comma-separated list of allowed origins |

### Managing the API Key

**Via Dashboard:**
1. Go to Workers & Pages > `thresh-proxy` > Settings > Variables and Secrets
2. Edit `ANTHROPIC_API_KEY` and paste the new key
3. Click Save

**Via CLI:**
```bash
cd thresh-proxy
npx wrangler secret put ANTHROPIC_API_KEY
# Paste the key when prompted
```

### Rotating the API Key

1. Create a new key at [console.anthropic.com](https://console.anthropic.com) > Settings > API Keys
2. Update the secret in Cloudflare (see above)
3. Revoke the old key in the Anthropic console

## Monitoring

- **Cloudflare Dashboard**: Workers & Pages > `thresh-proxy` > Metrics — request counts, latency, errors
- **Anthropic Console**: Usage — token usage, costs, rate limits

> **Cost estimate**: Claude Opus 4.6 costs $15/M input tokens and $75/M output tokens. A typical research report uses ~5K input + ~3K output tokens (~$0.30). Set a monthly spend limit at Anthropic Console > Settings > Billing > Limits.

## Deploying from Scratch

If you need to recreate the worker:

### Step 1: Create the Worker

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages**
3. Click **Create** > **Create Worker**
4. Name it: `thresh-proxy`
5. Click **Deploy**

### Step 2: Upload the Code

1. Click **"Edit code"** in the dashboard
2. Select all and delete the default Hello World code
3. Paste the contents of `src/index.js`
4. Click **Save and Deploy**

Or via CLI:
```bash
cd thresh-proxy
npx wrangler deploy
```

### Step 3: Add the API Key

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# Paste your sk-ant-... key when prompted
```

### Step 4: Add Custom Domain

1. Go to worker Settings > Domains & Routes
2. Add custom domain: `api.the-threshing-floor.com`
3. Cloudflare will configure the DNS automatically

## Local Development

```bash
cd thresh-proxy

# Create a .dev.vars file with your API key for local testing
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > .dev.vars

# Start the local dev server
npx wrangler dev

# The worker will be available at http://localhost:8787
```

> **Important**: Never commit `.dev.vars` — it contains your API key. It's already in `.gitignore`.
