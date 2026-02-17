# The Threshing Floor

> *The waters rose and the feed became a flood — not of rain, but of noise. Every voice at once, none distinguishable. The signal drowned. Someone had to build the high ground.*

**Thresh** is a free, open-source tool for collecting and exporting Reddit data. It runs entirely in your browser — no server, no database, no API keys, no code. Point it at a subreddit, tell it what to gather, and it hands you a clean dataset with a complete record of how it was collected.

It exists because public discourse is worth studying, and the people who want to study it shouldn't need a computer science degree to do it. Scientists, journalists, civic technologists, teachers, curious citizens — if you've ever wanted to know *what people are actually saying* in a corner of the internet, and you've wanted to do it carefully and transparently, this is for you.

---

## Use It Now

**[threshingfloor.pages.dev](https://threshingfloor.pages.dev)** — open the live site and start collecting. Nothing to install.

Or deploy your own instance (see below).

---

## How It Works

Thresh is a static site deployed to [Cloudflare Pages](https://pages.cloudflare.com). There is no backend server. Your data never leaves your browser.

1. **Reddit's public JSON** — Every Reddit page serves JSON alongside HTML. Thresh reads this through a lightweight edge proxy (a Cloudflare Pages Function) that handles browser security restrictions. No Reddit API key is needed.
2. **Client-side processing** — All data collection, filtering, analysis, and export happens in your browser using JavaScript. Nothing is stored on any server.
3. **Local persistence** — Collections are saved in your browser's `localStorage` so they survive page refreshes. Clear your browser data to clear Thresh data.

### The Workflow

| Stage | The Work | What You Do |
|-------|----------|-------------|
| **The Floor** | The workspace | Dashboard — your recent collections, quick actions |
| **Thresh** | Beating the grain | Enter a subreddit, configure sort/time/limit, collect |
| **Harvest** | Gathering what fell | Browse data in sortable tables, filter, inspect posts |
| **Glean** | Bundling clean grain | Export as CSV or JSON — sealed with a provenance document |
| **Winnow** | Wind carries away chaff | AI-powered analysis with Claude (optional, bring your own key) |

### A typical session

1. **Thresh** — *"Collect the top 100 posts from r/publichealth this month"*
2. **Harvest** — scan the table, search for keywords, check the stats
3. **Glean** — download a ZIP with your data and a `provenance.txt` file

That provenance file is the receipt. It records everything: what you asked for, what you got, when, and how. Anyone reviewing your work sees exactly how the grain was separated from the chaff.

---

## Deploy Your Own

Thresh is designed to be forked and deployed with zero configuration.

### Cloudflare Pages (recommended)

1. **Fork this repository** on GitHub
2. Go to the **[Cloudflare Dashboard](https://dash.cloudflare.com)** and select your account
3. Navigate to **Workers & Pages** > **Create** > **Pages** > **Connect to Git**
4. Select your forked repository
5. Configure the build:
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
6. Click **Save and Deploy**

That's it. Cloudflare will build and deploy automatically on every push. Your instance will be live at `<project-name>.pages.dev`.

The free tier includes:
- 500 deploys per month
- Unlimited bandwidth
- Unlimited requests
- Edge functions (the Reddit proxy) included

### Local Development

If you want to run Thresh locally for development:

```bash
# Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# Clone and run
git clone https://github.com/jethomasphd/The_Threshing_Floor.git
cd The_Threshing_Floor
npx wrangler pages dev public
```

Open **http://localhost:8788** in your browser. The local dev server includes full Pages Function support (the Reddit proxy works locally).

---

## The Provenance Seal

Every export is a ZIP containing:

- **Your data** — CSV (opens cleanly in Excel) or JSON
- **provenance.txt** — a complete methodological record:
  - Tool name and version
  - Data source (Reddit public JSON endpoints)
  - Subreddit(s) queried
  - All query parameters (sort, time filter, keywords, limits)
  - Collection timestamp (UTC)
  - Records collected vs. requested
  - Anonymization status
  - Ethical use reminders
  - Citation suggestion

Usernames are anonymized by default. If your work requires real usernames, Thresh lets you opt in — and documents that choice in provenance so your transparency is on the record.

---

## AI Analysis (Optional)

The **Winnow** page offers AI-powered analysis using Claude by Anthropic. This feature is entirely optional and requires your own API key.

- Get a key at [console.anthropic.com](https://console.anthropic.com)
- Enter it in the Winnow settings modal — it's stored in your browser's `localStorage` only
- Your key is sent directly to Anthropic's API through an edge function — it is never logged or stored on any server

Available analyses: theme identification, sentiment analysis, discussion summaries, question extraction, and custom prompts.

Without an API key, Winnow still provides a **word frequency chart** (Chart.js, runs entirely client-side).

---

## Ethics and Privacy

- **Your data stays with you.** Everything runs in your browser. The edge proxy forwards Reddit requests and nothing else. No analytics, no tracking, no telemetry.
- **Anonymization by default.** Reddit usernames can be traced to real people. Thresh replaces them in exports unless you explicitly choose otherwise.
- **Rate-limit respect.** The edge proxy adds small delays between requests. Reddit's public JSON endpoints are accessed the same way any browser would.
- **Institutional review.** If your organization requires ethics board approval for social media research, the provenance document provides the methodological transparency reviewers need.
- **Reddit Terms of Service.** Thresh accesses only public data — the same content visible to any browser. It is your responsibility to ensure your use of collected data complies with applicable policies and laws.

---

## Architecture

```
The_Threshing_Floor/
├── public/                     # Static site (Cloudflare Pages build output)
│   ├── index.html              # Single-page app with cinematic intro
│   ├── css/thresh.css          # Design system
│   ├── js/
│   │   ├── app.js              # Router, state, UI orchestration
│   │   ├── reddit.js           # Reddit JSON fetching via proxy
│   │   ├── exporter.js         # CSV/JSON + provenance ZIP generation
│   │   └── claude.js           # Optional Claude API integration
│   └── img/                    # Sigil and favicon SVGs
├── functions/                  # Cloudflare Pages Functions (edge)
│   └── api/
│       ├── reddit.js           # CORS proxy for Reddit public JSON
│       └── claude.js           # Proxy for Anthropic API
├── package.json                # Dev scripts (wrangler)
└── wrangler.toml               # Cloudflare local dev config
```

**No build step.** No bundler, no framework, no transpiler. The `public/` directory is served as-is. JavaScript is vanilla ES6+. CSS is handwritten. Fonts and libraries load from CDNs.

---

## Citation

If you use Thresh in published work:

```
Thomas, J. E. (2025). The Threshing Floor: A browser-based tool for Reddit
data collection and export (Version 1.0.0) [Computer software].
https://github.com/jethomasphd/The_Threshing_Floor
```

The provenance document in each export contains the exact parameters used and can be cited directly in a methods section.

---

## License

MIT

---

*A Jacob E. Thomas artifact. The waters rise. The Floor holds.*
