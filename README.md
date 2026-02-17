# The Threshing Floor

> *The waters rose and the feed became a flood — not of rain, but of noise. Every voice at once, none distinguishable. The signal drowned. Someone had to build the high ground.*

**Thresh** is a free, open-source tool for collecting and exporting Reddit data. It runs entirely in your browser — no server, no database, no API keys, no code. Point it at a subreddit, tell it what to gather, and it hands you a clean dataset with a complete record of how it was collected.

It exists because public discourse is worth studying, and the people who want to study it shouldn't need a computer science degree to do it. Scientists, journalists, civic technologists, teachers, curious citizens — if you've ever wanted to know *what people are actually saying* in a corner of the internet, and you've wanted to do it carefully and transparently, this is for you.

---

## Use It Now

**[the-threshing-floor.pages.dev](https://the-threshing-floor.pages.dev)** — open the live site and start collecting. Nothing to install.

Or deploy your own instance (see below).

---

## Use Cases

### Public Health Researcher

> *"What are people in r/mentalhealth talking about this month?"*

1. **Thresh** — `r/mentalhealth` · Sort by **Top** · **Past month** · 100 posts
2. **Harvest** — Sort by `score` to find what resonates most with the community
3. **Winnow** — Run **Identify themes** to map dominant concerns, then **Sentiment analysis** to gauge emotional tone
4. **Glean** — Export CSV with anonymized usernames for IRB-ready analysis. Cite `provenance.txt` in your methods section

### Journalist

> *"What questions are people asking in r/personalfinance about student loans?"*

1. **Thresh** — `r/personalfinance` · Sort by **Top** · **Past week** · keyword: `student loans`
2. **Harvest** — Sort by `num_comments` for the biggest conversations. Click into high-comment posts to read the full thread
3. **Winnow** — Run **Extract questions** to find what people need answered. Use a **Custom prompt**: *"What specific policy changes are people advocating for?"*
4. **Glean** — Provenance.txt gives your editor a transparent methodology section

### Graduate Student

> *"I need to compare discourse in r/science vs. r/conspiracy for my thesis."*

1. **Thresh** — Enter `science, conspiracy` (comma-separated) · Sort by **Top** · **Past year** · keyword: `vaccine`
2. **Harvest** — Compare `upvote_ratio` across subreddits to see consensus vs. division. A ratio of 0.95 means near-unanimous approval; below 0.60 means deeply divisive
3. **Winnow** — Run **Sentiment analysis** on each collection, then a **Custom prompt**: *"Compare the tone and evidence standards between these two communities"*
4. **Glean** — Two exports, each with its own provenance — cite both in your methods section

### Community Organizer

> *"What are residents saying in our city's subreddit about the new transit plan?"*

1. **Thresh** — `r/yourcity` · Sort by **New** · **Past month** · keyword: `transit` · **Include comments**
2. **Harvest** — Enable comments to hear the full conversation, not just headlines. Search for specific routes or proposals
3. **Winnow** — Run **Summarize discussion** to distill what people actually want. Run **Extract questions** to identify unaddressed concerns
4. **Glean** — JSON export feeds directly into your own tools or dashboards

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
| **Winnow** | Wind carries away chaff | Analyze with word frequency and optional AI (bring your own key) |
| **Glean** | Bundling clean grain | Export as CSV or JSON — sealed with a provenance document |

### A typical session

1. **Thresh** — *"Collect the top 100 posts from r/publichealth this month"*
2. **Harvest** — scan the table, search for keywords, check the stats
3. **Winnow** — run word frequency analysis; optionally run Claude AI for themes or sentiment
4. **Glean** — download a ZIP with your data and a `provenance.txt` file

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

## Data Field Reference

Every post and comment you collect has structured fields. Understanding them is essential for meaningful analysis.

### Post Fields

| Field | Type | What It Means |
|-------|------|---------------|
| `id` | string | Unique Reddit post identifier |
| `subreddit` | string | Community name (you can collect from multiple at once) |
| `title` | string | Post headline — always present, primary text for keyword analysis |
| `author` | string | Reddit username (anonymized to `user_a1b2c3` in exports by default) |
| `selftext` | string | Body text of self-posts. **Empty for link posts.** This is where the real discourse lives |
| `score` | number | Net votes (upvotes minus downvotes). A post with `score: 500` was upvoted ~500 more times than downvoted. **High score = community resonance** |
| `upvote_ratio` | number | Fraction of votes that were upvotes (0.0–1.0). `0.95` = near-unanimous approval. `0.55` = deeply divisive. **This is what "Controversial" sort finds** |
| `num_comments` | number | Total comment count. **High comments + low score = debate. High comments + high score = broad engagement** |
| `created_utc` | number | Unix timestamp of creation. Exported as both Unix and ISO date |
| `created_date` | string | Human-readable ISO date (computed at export) |
| `url` | string | Direct URL — either an external link or the Reddit post itself |
| `permalink` | string | Full Reddit URL for the post |
| `is_self` | boolean | `true` if text post, `false` if link post. Self-posts have content in `selftext` |
| `link_flair_text` | string | Category label set by moderators (e.g., "Discussion", "News", "Vent"). Useful for filtering by post type |
| `domain` | string | Source domain for link posts (`nytimes.com`, `youtube.com`) or `self.subreddit` for text posts |
| `over_18` | boolean | NSFW flag |

### Comment Fields

| Field | Type | What It Means |
|-------|------|---------------|
| `id` | string | Unique comment identifier |
| `post_id` | string | Links this comment back to its parent post |
| `author` | string | Commenter username (anonymized in exports by default) |
| `body` | string | Comment text — where you find personal experiences, opinions, and replies |
| `score` | number | Comment votes. High-score comments are what the community endorsed |
| `created_utc` | number | When the comment was posted |
| `depth` | number | Nesting level. `0` = top-level reply to the post. `1` = reply to a top-level comment. Collected to depth 2 |
| `parent_id` | string | ID of the parent comment (for threading) |

### Reading the Data Like a Researcher

- **Sort by `score` descending** to find what the community most agrees with
- **Sort by `num_comments` descending** to find the most active discussions
- **Filter for `upvote_ratio` < 0.60** to identify divisive content
- **Compare `score` to `num_comments`**: a post with 50 score but 200 comments is contentious; a post with 500 score and 20 comments is broadly approved but didn't spark conversation
- **Use `link_flair_text`** to categorize posts before analysis (many subreddits require flair)
- **Check `is_self`**: self-posts contain original writing; link posts are shared content. Filter accordingly for your research question
- **Use `domain`** to track which external sources a community shares and trusts

---

## Analysis Methods

### Built-in (No API Key Required)

These run entirely in your browser at zero cost:

| Method | Where | What It Does |
|--------|-------|--------------|
| **Word Frequency** | Winnow | Top 20 most common words across all post titles and bodies. Common stopwords ("the", "and", "is") are filtered out. Tells you the literal vocabulary of the conversation |
| **Sortable Table** | Harvest | Click any column header to sort ascending/descending. Sort by `score`, `num_comments`, `date`, `author`, or `title` |
| **Summary Statistics** | Harvest | Post count, average score, average comments, and date range — calculated automatically for every collection |
| **Search Filter** | Harvest | Live text search across titles, authors, and post bodies |

### Claude AI Analysis (Optional — Bring Your Own Key)

Claude reads your collected posts (up to 50 are sampled to stay within token limits) and produces structured research analysis. It goes beyond counting words — it understands meaning, groups ideas, and identifies patterns.

| Analysis Type | Best For | What Claude Returns |
|---------------|----------|---------------------|
| **Identify Themes** | First pass on unfamiliar data | Thematic clusters with names, post counts, and examples. *"Theme 1: Access to Care (23 posts) — Users describe long wait times, insurance denials…"* |
| **Sentiment Analysis** | Tracking community mood | Overall tone classification, emotional patterns, sentiment shifts, and specific examples |
| **Summarize Discussion** | Briefings and literature reviews | Main points, areas of agreement/disagreement, and standout observations |
| **Extract Questions** | Journalists and service providers | Questions people are asking, categorized by topic. Reveals information gaps and unmet needs |
| **Custom Prompt** | Anything | Your own analysis prompt combined with the data. Examples below |

#### Example Custom Prompts

```
"What misconceptions appear most frequently in these posts?"
"Identify posts that describe personal experiences vs. those sharing news articles."
"What specific policy changes are people advocating for?"
"Compare the tone of high-score vs. low-score posts."
"What resources or solutions are people recommending to each other?"
"Are there any posts that might indicate crisis or urgent need?"
```

### How Claude Integration Works

1. Get a key at [console.anthropic.com](https://console.anthropic.com)
2. Enter it in the Winnow settings modal — it's stored in your browser's `localStorage` only
3. Your key is sent directly to Anthropic's API through a Cloudflare edge function — **it is never logged or stored on any server**
4. Claude (Sonnet) analyzes a summary of up to 50 posts from your collection
5. Results appear in the "Claude's Analysis" panel — marked as AI-generated

Without an API key, the word frequency chart and all Harvest-page analytics work normally. Claude is a supplement, not a requirement.

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

---

## Ethics and Privacy

- **Your data stays with you.** Everything runs in your browser. The edge proxy forwards Reddit requests and nothing else. No analytics, no tracking, no telemetry.
- **Anonymization by default.** Reddit usernames can be traced to real people. Thresh replaces them in exports unless you explicitly choose otherwise.
- **Rate-limit respect.** The edge proxy adds small delays between requests. Reddit's public JSON endpoints are accessed the same way any browser would.
- **Institutional review.** If your organization requires ethics board approval for social media research, the provenance document provides the methodological transparency reviewers need.
- **Reddit Terms of Service.** Thresh accesses only public data — the same content visible to any browser. It is your responsibility to ensure your use of collected data complies with applicable policies and laws.

---

## Your Data & Storage

**Everything is stored in your browser.** There is no server database, no account system, and no cloud sync.

| What | Where | localStorage Key |
|------|-------|------------------|
| Your collections (posts, comments, config) | Browser localStorage | `thresh_collections` |
| Anthropic API key (if you use Claude analysis) | Browser localStorage | `thresh_claude_key` |
| Rate limit state | Browser localStorage | `thresh_rate_limit` |
| Subreddit metadata cache (15-min TTL) | Browser localStorage | `thresh_subreddit_cache` |

The two Cloudflare edge functions (`/api/reddit` and `/api/claude`) are **stateless proxies** — they forward requests and return responses. They do not log, store, or inspect your data.

This means:
- Your data **does not sync** across browsers or devices
- If you switch browsers, your collections will not follow
- If you clear browser data, your collections are gone

### Clearing Your History

To erase all Thresh data:

**Quick method (all site data):**
1. Open your browser's **Settings** (or press `Ctrl+Shift+Delete` / `Cmd+Shift+Delete`)
2. Navigate to **Privacy & Security** → **Clear browsing data**
3. Select **"Cookies and site data"** (this includes localStorage)
4. Clear for the Thresh site

**Precise method (individual keys):**
1. Open **Developer Tools** (`F12`)
2. Go to the **Application** tab
3. Expand **Local Storage** in the left sidebar
4. Find the Thresh site entry
5. Delete individual keys (e.g., just `thresh_collections` to clear collections but keep your API key) or click **Clear All**

This removes all saved collections, your API key (if stored), rate limit state, and cached data. **It cannot be undone.**

---

## The Rate Limit Gauge

The **Rate Limit** gauge at the bottom of the sidebar tracks your current Reddit rate limit status. Reddit allows **100 requests per minute** to its public JSON endpoints.

| Gauge State | Meaning |
|-------------|---------|
| **Gold bar (full)** | Plenty of requests remaining. Normal operation. |
| **Yellow bar (below 30%)** | Requests running low. Consider pausing between collections. |
| **Red pulsing bar (below 10%)** | Critical. Thresh will pause automatically if the limit is reached. |
| **Cooldown timer** | You've hit the limit. A countdown shows when requests resume. The collect button is disabled until the cooldown expires. |

The rate limit resets automatically each minute. Under normal use (25–100 posts per collection), you will rarely see it drop below gold. The gauge reads from Reddit's actual rate limit response headers, so it reflects your real remaining quota — not an estimate.

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
Thomas, J. E. (2026). The Threshing Floor: A browser-based tool for Reddit
data collection and export (Version 1.0.0) [Computer software].
https://github.com/jethomasphd/The_Threshing_Floor
```

The provenance document in each export contains the exact parameters used and can be cited directly in a methods section.

---

## License

MIT

---

*A Jacob E. Thomas artifact. The waters rise. The Floor holds.*
