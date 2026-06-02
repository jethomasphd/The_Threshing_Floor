# thresh-fly-proxy — Setup Guide

This tiny Node.js service is deployed to [Fly.io](https://fly.io) and acts as a relay between the Cloudflare Pages Function (`functions/api/reddit.js`) and Reddit's public JSON endpoints. It exists because Reddit blocks anonymous requests from Cloudflare datacenter IP ranges (returning 403 for every subreddit), but does not block Fly's IP ranges.

## Architecture

```
Browser → Cloudflare Pages Function → Fly.io proxy → Reddit (public JSON)
              (CORS + auth)          (User-Agent + secret check)
```

- **Browser** never talks to Fly directly. The Fly URL is not exposed to client code.
- **Cloudflare Pages Function** holds the Fly URL and a shared secret as Cloudflare secrets, and forwards each request server-to-server.
- **Fly.io proxy** verifies the shared secret, fetches Reddit's public JSON with a proper User-Agent, and forwards Reddit's rate-limit headers back so the existing client-side rate limiter keeps working.

The shared secret prevents random people from finding the Fly URL and using it as an open Reddit proxy.

## Setup (browser-only — no local terminal required)

If you have local `flyctl` installed, you can skip to the "CLI alternative" section at the bottom. The default path below uses Fly's web dashboard plus a GitHub Actions deploy.

### Step 1: Create the Fly app

1. Go to **[fly.io/dashboard](https://fly.io/dashboard)** and log in.
2. Click **"Launch an app"** (or **"Create app"** depending on the dashboard version).
3. Choose **"Create app from scratch"** / **"Empty app"**.
4. Enter an app name. **It must be globally unique on Fly**. Suggested: `thresh-reddit-proxy`. If taken, try `thresh-reddit-proxy-<your-handle>`.
5. Pick a region close to your users (default `iad` = Virginia is fine).
6. Click **Create**. The app is now reserved but has no code yet.

### Step 2: Update `fly.toml` to match the app name you chose

Edit `thresh-fly-proxy/fly.toml` on GitHub:

1. Open the file in the GitHub web UI.
2. Click the pencil icon (top right) to edit.
3. Change the `app = "..."` line to the exact name you registered in Step 1.
4. Commit directly to the branch you're deploying from.

### Step 3: Generate a Fly API token

1. In the Fly dashboard, click your user avatar (top right) → **Account Settings** (or **Tokens**).
2. Find **"Access Tokens"** in the sidebar.
3. Click **"Create access token"**.
4. Name it `github-actions-deploy`.
5. Copy the token immediately — Fly only shows it once.

### Step 4: Add the token to GitHub Actions

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **"New repository secret"**.
3. Name: `FLY_API_TOKEN`
4. Value: paste the token from Step 3.
5. Click **Add secret**.

### Step 5: Trigger the first deploy

The deploy workflow (`.github/workflows/fly-deploy.yml`) runs automatically on changes to `thresh-fly-proxy/**` on the main branch, and can also be triggered manually.

**Manual trigger (recommended for first deploy):**

1. Go to GitHub repo → **Actions** tab.
2. In the left sidebar, click **"Deploy thresh-fly-proxy"**.
3. Click **"Run workflow"** (top right).
4. Pick the branch you want to deploy from.
5. Click **"Run workflow"** (green button).
6. Watch the run. First deploy takes 2–3 minutes.

When the run succeeds, your proxy is live at `https://<your-app-name>.fly.dev`.

### Step 6: Verify the proxy is up

In a browser, visit:

```
https://<your-app-name>.fly.dev/health
```

You should see:

```json
{"ok":true,"service":"thresh-fly-proxy"}
```

If the page is slow on first load, that's the Fly machine cold-starting from idle — normal.

### Step 7: Set the shared secret on Fly

1. In the Fly dashboard, open your app.
2. Sidebar → **Secrets**.
3. Click **"Add secret"** (or **"Set secrets"**).
4. Name: `PROXY_SECRET`
5. Value: generate a long random string (~64 chars). Use any password generator.
6. Save. Fly will redeploy the app automatically with the new secret bound.

Keep this string — you'll need it for Cloudflare in the next step.

### Step 8: Wire it into Cloudflare Pages

Add two secrets to the `threshing-floor` Cloudflare Pages project (Settings → Variables and Secrets → Production):

| Name | Value |
|---|---|
| `FLY_PROXY_URL` | `https://<your-app-name>.fly.dev` (no trailing slash) |
| `FLY_PROXY_SECRET` | the same random string from Step 7 |

Trigger a redeploy of the Pages project so the new secrets bind to the function.

### Step 9: Verify end-to-end

Open the live Thresh site and run a collection on a public subreddit (e.g. `r/news`). It should succeed.

## Updating the proxy

After making changes to `thresh-fly-proxy/server.js` and pushing to main, GitHub Actions auto-deploys. To force a deploy at any time, trigger the workflow manually from the Actions tab.

## Cost

Fly's free allowances cover this proxy easily for typical research use:
- 3 shared-CPU 256MB machines (we use 1)
- The machine auto-stops when idle and auto-starts on the next request (~1s cold-start)
- No persistent storage needed

Expect $0/month for personal research use.

## Rotating the shared secret

1. Generate a new random string.
2. Fly dashboard → app → Secrets → edit `PROXY_SECRET`.
3. Update `FLY_PROXY_SECRET` in Cloudflare Pages.
4. Redeploy the Pages project.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| GitHub Actions deploy fails on first run with "app not found" | `fly.toml` `app =` doesn't match the name you registered | Edit `fly.toml` to match exactly |
| GitHub Actions deploy fails with "unauthorized" | `FLY_API_TOKEN` missing or wrong | Re-check the secret in GitHub Actions settings |
| `Forbidden` from Cloudflare → Fly | Shared secret mismatch | Confirm `PROXY_SECRET` on Fly equals `FLY_PROXY_SECRET` on Cloudflare |
| `/health` returns OK but collections still fail | Cloudflare Pages function not yet pointed at Fly | Make sure `FLY_PROXY_URL` is set on Cloudflare and Pages has redeployed |
| 403 from Reddit on specific subreddit only | That subreddit really is private/quarantined | Expected; try a public sub like `r/news` |
| 429 from Reddit | Rate limit hit | The client rate limiter will back off; wait |
| Fly app cold-start lag | Machine auto-stopped after idle | First request after idle takes ~1–2s; normal |

## CLI alternative (if you have flyctl installed)

```bash
# One-time setup
flyctl auth login
cd thresh-fly-proxy
flyctl apps create <your-chosen-app-name>
# edit fly.toml's `app =` to match
flyctl secrets set PROXY_SECRET=<random-string>
flyctl deploy

# Future updates
flyctl deploy
```
