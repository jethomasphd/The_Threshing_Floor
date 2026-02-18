# thresh-proxy — Setup Guide

This Cloudflare Worker serves as a dedicated Anthropic API proxy for The Threshing Floor. It stores your Anthropic API key as a server-side secret so end users never need their own key.

## Why a Separate Worker?

- **Segmentation**: Keeps The Threshing Floor's API usage separate from any other projects
- **Key isolation**: A dedicated API key means you can monitor usage, set spend limits, and revoke access independently
- **No client-side keys**: Users never see or handle an API key — the worker manages authentication

## Setup via Cloudflare Dashboard (Recommended)

### Step 1: Get an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Navigate to **Settings** > **API Keys**
3. Click **Create Key**
4. Name it something clear: `thresh-proxy-production`
5. Copy the key (starts with `sk-ant-...`) — you'll need it in Step 4

> **Tip**: Set a monthly spend limit on this key at **Settings > Billing > Limits** to control costs. Claude Opus 4.6 costs $15/M input tokens and $75/M output tokens. A typical research report uses ~5K input + ~3K output tokens (~$0.30).

### Step 2: Create the Worker

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account
3. Navigate to **Workers & Pages** in the left sidebar
4. Click **Create**
5. Select **"Create Worker"**
6. Name it: `thresh-proxy`
7. Click **Deploy** (this creates the worker with the default "Hello World" script)

### Step 3: Upload the Worker Code

**Option A — Via the Dashboard Editor:**
1. After deploying, click **"Edit code"**
2. Delete the default code in `worker.js`
3. Paste the contents of `src/index.js` from this directory
4. Click **Save and Deploy**

**Option B — Via Wrangler CLI:**
```bash
cd thresh-proxy
npx wrangler deploy
```

### Step 4: Add Your API Key as a Secret

**Via Dashboard:**
1. Go to your `thresh-proxy` worker in the dashboard
2. Click **Settings** > **Variables and Secrets**
3. Under **Secrets**, click **Add**
4. Name: `ANTHROPIC_API_KEY`
5. Value: paste your `sk-ant-...` key
6. Click **Save**

**Via CLI:**
```bash
cd thresh-proxy
npx wrangler secret put ANTHROPIC_API_KEY
# Paste your key when prompted
```

### Step 5: (Optional) Restrict Origins

By default, the worker accepts requests from any origin. To restrict it to only your Threshing Floor deployment:

1. Go to worker **Settings** > **Variables and Secrets**
2. Under **Environment Variables**, click **Add**
3. Name: `ALLOWED_ORIGINS`
4. Value: `https://the-threshing-floor.pages.dev,http://localhost:8788`
5. Click **Save**

### Step 6: Configure The Threshing Floor

Once your worker is deployed, note its URL. It will be:
```
https://thresh-proxy.<your-account>.workers.dev
```

Now update The Threshing Floor's client-side configuration:

1. Open `public/js/claude.js`
2. Find the `MANAGED_PROXY_URL` constant at the top
3. Set it to your worker URL:
   ```javascript
   MANAGED_PROXY_URL: 'https://thresh-proxy.<your-account>.workers.dev',
   ```
4. Commit and deploy

That's it. The Threshing Floor will automatically detect that a managed proxy is configured and offer users the choice to use it without entering their own API key.

## How It Works

```
User's Browser                thresh-proxy Worker              Anthropic API
     |                              |                              |
     |-- POST {messages, system} -->|                              |
     |                              |-- adds ANTHROPIC_API_KEY  -->|
     |                              |   from Cloudflare secret     |
     |                              |<-- Claude response ----------|
     |<-- proxied response ---------|                              |
```

- The worker stores your API key as a **Cloudflare Secret** — encrypted at rest, never visible in logs or dashboards
- Requests are validated (must include `messages` array)
- CORS headers are set for browser access
- The model is set to `claude-opus-4-6` (Anthropic's most capable model) with 8192 max tokens
- GET requests return a health check JSON response

## Model

The worker is configured to use **Claude Opus 4.6** (`claude-opus-4-6`), Anthropic's most capable model. This produces the highest-quality research reports and analysis. To change the model, edit the `MODEL` constant in `src/index.js`.

## Monitoring

Once deployed, you can monitor usage in the Cloudflare dashboard:
- **Workers & Pages** > **thresh-proxy** > **Metrics** — request counts, latency, errors
- **Anthropic Console** > **Usage** — token usage, costs, rate limits

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
