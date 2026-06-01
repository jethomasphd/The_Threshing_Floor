# functions/api/reddit.js — Setup Guide

This Cloudflare Pages Function proxies Reddit data requests through Reddit's OAuth API (`oauth.reddit.com`) using app-only authentication. It exists because Reddit started blocking anonymous JSON requests from Cloudflare's datacenter IP ranges, which returned 403 for every subreddit regardless of whether it was actually private.

Switching to OAuth solves this permanently:
- Reddit does not IP-block authenticated OAuth requests
- The free tier OAuth quota is 100 requests/minute per `client_id` (up from ~10/min anonymous)
- End users still bring no credentials — only the operator holds one app-level secret

## Architecture

```
User's Browser           Pages Function                Reddit OAuth API
     |                         |                              |
     |-- GET /api/reddit?... ->|                              |
     |                         |-- POST /api/v1/access_token->|
     |                         |   (Basic auth: ID:SECRET)    |
     |                         |<-- bearer token (1h ttl) ----|
     |                         |                              |
     |                         |-- GET oauth.reddit.com/... ->|
     |                         |   (Authorization: Bearer)    |
     |                         |<-- JSON response ------------|
     |<-- proxied response ----|                              |
```

- The token is cached in module-level state per Worker isolate. A typical 1-hour token covers many requests before re-fetching.
- All requests go to `oauth.reddit.com` instead of `www.reddit.com`. The proxy strips the `.json` suffix from incoming paths since the OAuth endpoints don't use it.
- Rate-limit headers (`x-ratelimit-*`) are forwarded to the client exactly as before — the existing rate limiter in `public/js/reddit.js` Just Works.

## One-Time Setup

### Step 1: Register a Reddit app

1. Visit [https://www.reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) (logged in as the account that should own this app).
2. Scroll to the bottom and click **"are you a developer? create an app..."**.
3. Fill in the form:
   - **name**: `The Threshing Floor`
   - **App type**: select **"web app"** (not "script", not "installed app")
   - **description**: `Local-first Reddit data collection tool for researchers and journalists.`
   - **about url**: `https://the-threshing-floor.com`
   - **redirect uri**: `https://the-threshing-floor.com/oauth-callback` (required field; unused for client_credentials but must be present)
4. Click **"create app"**.
5. Note the two values shown for the new app:
   - **client ID** — short string under the app name (e.g. `aBc12_xyz`)
   - **secret** — longer string labeled "secret"

### Step 2: Add the secrets to Cloudflare Pages

**Via Dashboard (recommended):**

1. Cloudflare Dashboard → **Workers & Pages** → select the `threshing-floor` Pages project.
2. **Settings** → **Variables and Secrets** (or "Environment variables").
3. Add two secrets in the **Production** environment:
   - `REDDIT_CLIENT_ID` → paste the client ID, mark as **encrypted**.
   - `REDDIT_CLIENT_SECRET` → paste the secret, mark as **encrypted**.
4. Repeat for the **Preview** environment if you want the staging deploys to work too.
5. Trigger a redeploy (push a commit, or use "Retry deployment") so the new secrets take effect.

**Via CLI:**

```bash
npx wrangler pages secret put REDDIT_CLIENT_ID --project-name=threshing-floor
# paste the client ID

npx wrangler pages secret put REDDIT_CLIENT_SECRET --project-name=threshing-floor
# paste the secret
```

### Step 3: Verify

After the next deployment, open the site and run a collection on a known-public subreddit (e.g. `r/news`). It should now succeed.

If you still see "Reddit OAuth is not configured" → the secrets aren't visible to the function; redeploy.
If you see "Could not authenticate with Reddit" → the credentials are wrong; double-check them in the Reddit app settings.
If you see 403/404 on specific subreddits only → that subreddit really is private, banned, or quarantined.

## Local Development

For `npx wrangler pages dev public` to talk to Reddit, drop a `.dev.vars` file in the project root:

```bash
cat > .dev.vars <<'EOF'
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
EOF
```

`.dev.vars` is already in `.gitignore` — never commit it.

## User-Agent

The proxy sends Reddit a User-Agent of:

```
web:com.the-threshing-floor:v1.1 (by /u/jethomasphd)
```

This follows Reddit's recommended format: `<platform>:<app-id>:<version> (by /u/<reddit-username>)`. If the Reddit username at the end doesn't match the account that owns the registered app, update the `USER_AGENT` constant at the top of `functions/api/reddit.js` and redeploy.

## Rotating Credentials

If you need to rotate the Reddit app secret:

1. In [Reddit's app settings](https://www.reddit.com/prefs/apps), click **edit** on the app, then **"reset secret"**.
2. Update `REDDIT_CLIENT_SECRET` in Cloudflare Pages (dashboard or CLI).
3. Redeploy. Any cached tokens in running isolates will be replaced automatically on the next 401.
