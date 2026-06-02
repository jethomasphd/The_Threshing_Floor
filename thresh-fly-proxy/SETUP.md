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

## One-Time Setup

### Prerequisites

- A free [Fly.io](https://fly.io) account (sign up with GitHub)
- The `flyctl` CLI installed locally — see [fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/)
- This repository cloned locally

### Step 1: Authenticate with Fly

```bash
flyctl auth login
```

This opens a browser window. Log in with the GitHub account you used for Fly.

### Step 2: Pick a globally-unique app name

Fly app names are global. Edit `thresh-fly-proxy/fly.toml` and change the `app` line if `thresh-reddit-proxy` is already taken (it might be):

```toml
app = "thresh-reddit-proxy-<your-handle>"
```

### Step 3: Create the app

```bash
cd thresh-fly-proxy
flyctl apps create <your-chosen-app-name>
```

If the name is taken, Fly will tell you and you can pick a different one. Make sure `fly.toml`'s `app =` line matches whatever you chose.

### Step 4: Generate and set the shared secret

Pick a long random string. On macOS/Linux:

```bash
openssl rand -hex 32
```

Or on any platform, use any random ~64-character string.

Save it somewhere safe, then set it as a Fly secret:

```bash
flyctl secrets set PROXY_SECRET=<the-random-string>
```

You'll add the same value to Cloudflare in Step 6.

### Step 5: Deploy

```bash
flyctl deploy
```

First deploy takes ~1–2 minutes. When it succeeds, Fly will show a URL like:

```
https://thresh-reddit-proxy.fly.dev
```

Confirm it works:

```bash
curl https://<your-app>.fly.dev/health
# → {"ok":true,"service":"thresh-fly-proxy"}
```

### Step 6: Wire it into Cloudflare Pages

Add two secrets to the `threshing-floor` Cloudflare Pages project (Settings → Variables and Secrets → Production):

| Name | Value |
|---|---|
| `FLY_PROXY_URL` | `https://<your-app>.fly.dev` (no trailing slash) |
| `FLY_PROXY_SECRET` | the same random string from Step 4 |

Trigger a redeploy of the Pages project so the new secrets bind to the function.

### Step 7: Verify

Open the live site and run a collection on a public subreddit (e.g. `r/news`). It should succeed.

## Updating the proxy

After making changes to `server.js`:

```bash
cd thresh-fly-proxy
flyctl deploy
```

## Cost

Fly's free allowances cover this proxy easily for typical research use:
- 3 shared-CPU 256MB machines (we use 1)
- The machine auto-stops when idle and auto-starts on the next request (~1s cold-start)
- No persistent storage needed

Expect $0/month for personal research use.

## Rotating the shared secret

1. Generate a new random string.
2. `flyctl secrets set PROXY_SECRET=<new-string>` (no redeploy needed).
3. Update `FLY_PROXY_SECRET` in Cloudflare Pages.
4. Redeploy the Pages project.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Forbidden` from Cloudflare → Fly | Shared secret mismatch | Confirm `PROXY_SECRET` on Fly equals `FLY_PROXY_SECRET` on Cloudflare |
| `Could not reach Reddit proxy` from the site | `FLY_PROXY_URL` wrong or Fly app not running | `curl <url>/health` to verify |
| 403 from Reddit on specific subreddit only | That subreddit really is private/quarantined | Expected; try a public sub like `r/news` |
| 429 from Reddit | Rate limit hit | The client rate limiter will back off; wait |
| Fly app sleeping cold-start | Machine auto-stopped after idle | First request after idle takes ~1–2s; normal |
