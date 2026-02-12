# The Threshing Floor

> *The waters rose and the feed became a flood — not of rain, but of noise. Every voice at once, none distinguishable. The signal drowned. Someone had to build the high ground.*

**Thresh** is a tool for measuring what society is saying. It collects, explores, and exports Reddit data through a browser interface — no code, no installation, no command line. You point it at a community, tell it what to gather, and it hands you a clean dataset with a complete record of how it was collected.

It exists because public discourse is worth studying, and the people who want to study it shouldn't need a computer science degree to do it. Scientists, journalists, civic technologists, teachers, curious citizens — if you've ever wanted to know *what people are actually saying* in a corner of the internet, and you've wanted to do it carefully and transparently, this is for you.

---

## Open It

Click one button. Thresh launches in your browser. Nothing to install.

### GitHub Codespaces (recommended)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?hide_repo_select=true&repo=jethomasphd/The_Threshing_Floor)

That's it. The environment builds itself, the app starts automatically, and a browser tab opens with Thresh running. Free GitHub accounts include 60 hours/month of Codespaces.

### Gitpod

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/jethomasphd/The_Threshing_Floor)

Same idea — one click, browser-based, auto-starts. Gitpod's free tier includes 50 hours/month.

### On your own machine (advanced)

<details>
<summary>For users comfortable with Python and the command line</summary>

Requires Python 3.10+.

```bash
git clone https://github.com/jethomasphd/The_Threshing_Floor.git
cd The_Threshing_Floor
pip install -r requirements.txt
python -m app.main
```

Open **http://127.0.0.1:8000** in your browser.

</details>

---

## No Setup Needed

Open Thresh and start exploring. There are no API keys to configure, no credentials to obtain, no approval queues to wait in. Thresh reads Reddit's public pages directly — the same data you see in your browser — and structures it into clean datasets.

You're on the Floor.

### Optional: Reddit API Credentials (Power Users)

<details>
<summary>For higher rate limits and authenticated access</summary>

If you're collecting at scale and want higher rate limits, you can optionally connect Thresh to Reddit's API:

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and click **"create another app..."**
2. Set the type to **"script"** and the redirect URI to `http://localhost:8000`
3. Copy the **Client ID** and **Secret** into Thresh's About page under "Optional: Reddit API Credentials"
4. Click **Test Connection**, then **Save**

Without credentials, Thresh uses polite rate-limited requests to Reddit's public endpoints. With credentials, you get Reddit's official 100 requests/minute allowance via their API.

</details>

---

## What the Flood Looks Like — and What Thresh Does About It

Reddit generates millions of posts and comments every day. Inside that torrent lives real signal: how people talk about mental health, how communities form around crisis, what language shifts when policy changes, where misinformation takes root, how grief and hope move through populations in real time.

But the flood buries it. You can scroll forever and learn nothing systematic. You can't measure a river by standing in it.

Thresh pulls you up onto the threshing floor — the ancient high ground where grain was separated from chaff through deliberate labor. It gives you a five-stage workflow, each stage named for a step in that old process:

| Stage | The Work | What You Do |
|-------|----------|-------------|
| **The Floor** | The workspace | Dashboard — your recent collections, saved queries, quick actions |
| **Explore** | Scouting the field | Search subreddits by topic, preview posts, check community metadata |
| **Thresh** | Beating the grain | Configure and run data collection — sort, time range, keywords, depth |
| **Harvest** | Gathering what fell | Browse your data in sortable tables, filter, inspect individual posts |
| **Winnow** | Wind carries away chaff | Analyze — word frequency, temporal patterns, keyword exploration |
| **Glean** | Bundling clean grain | Export as CSV, JSON, or JSONL — sealed with a provenance document |

You don't need to remember these names. Every page has a plain subtitle telling you exactly what it does. The metaphor is there for those who find meaning in it; the interface works regardless.

### A typical session

1. **Explore** a question — *"What are people saying about housing costs in r/Denver?"*
2. **Thresh** the data — pull 500 posts from the past year, sorted by relevance, with top-level comments
3. **Harvest** the results — scan the table, check the stats, see what came back
4. **Winnow** the patterns — which words keep appearing? When did posting spike?
5. **Glean** your dataset — download a ZIP with your data and a `provenance.txt` file

That provenance file is the receipt. It records everything: what you asked for, what you got, when, and how. Anyone reviewing your work can see exactly how the grain was separated from the chaff.

---

## The Provenance Seal

Every export is a ZIP containing:

- **Your data** — CSV (opens cleanly in Excel), JSON, or JSONL
- **provenance.txt** — a complete methodological record:
  - Tool name and version
  - Data source (public web data or authenticated API)
  - Subreddit(s) queried
  - All query parameters (sort, time filter, keywords, limits)
  - Collection timestamp (UTC)
  - Records collected vs. requested
  - Post-collection filters applied
  - Anonymization status and method
  - Citation suggestion

Usernames are anonymized by default (`author_0001`, `author_0002`, ...). If your work requires real usernames, Thresh lets you opt in — and documents that choice in provenance so your transparency is on the record.

---

## Ethics and Privacy

Thresh is built for people who take measurement seriously, which means taking ethics seriously.

- **Your data stays with you.** Everything runs locally (or in your private Codespace). Nothing is sent to external servers. If you choose to configure API credentials, they are stored in a local file and never leave your environment.
- **Anonymization by default.** Reddit usernames can be traced to real people. Thresh replaces them in exports unless you explicitly choose otherwise.
- **Rate-limit respect.** Thresh paces its requests to be a polite visitor. With optional API credentials, you get Reddit's official 100 requests/minute allowance; without them, Thresh self-limits to well under that threshold and backs off on any throttling signal.
- **Institutional review.** If your organization requires ethics board approval for social media research, the provenance document provides the methodological transparency reviewers need.
- **Reddit Terms of Service.** Thresh accesses only public data — the same content visible to any browser. It is your responsibility to ensure your use of collected data complies with applicable policies and laws.

---

## Citation

If you use Thresh in published work:

```
Thomas, J. E. (2025). Thresh: The Threshing Floor (Version 0.1.0) [Computer software].
```

The provenance document in each export contains the exact version used and can be cited directly in a methods section.

---

## The Mythology

You don't need to know any of this to use Thresh. But if you're curious why the interface looks the way it does, why the names sound the way they sound:

The Threshing Floor is part of a lineage of **counter-technologies** — tools built to honor attention rather than exploit it. Its siblings include *The Watchtower* (an instrument for observing digital patterns with intention) and the *COMPANION Protocol* (a framework for ethical human-AI collaboration). Together they form the **Corpus of Self**: artifacts designed for people who refuse to be farmed by the Feed.

The aesthetic — dark ground, ember gold, ritualistic composure — is not decoration. It is a statement that someone cared about building this. That attention was paid. Deliberately. In a world that profits from distraction, the act of careful measurement is itself a kind of resistance.

The name comes from the biblical threshing floor, the high ground where grain was beaten free from chaff. Every harvest required it. No separation happened without labor. The Feed is the flood that buries the harvest under noise. Thresh is the floor that holds.

---

## For Developers

<details>
<summary>Architecture, testing, and contribution details</summary>

### Architecture

- **Backend**: FastAPI + Jinja2 + SQLAlchemy/SQLite
- **Data access**: Public JSON endpoints by default (`RedditScraper`), optional PRAW upgrade (`RedditClient`)
- **Frontend**: Server-rendered HTML with HTMX — no build step, no node_modules
- **Styling**: Tailwind CSS (CDN) + custom design system in `thresh.css`
- **Charts**: Chart.js for dashboards, Plotly.js for interactive exploration
- **Database**: SQLite — nothing to install, nothing to configure

### Project structure

```
The_Threshing_Floor/
  app/
    __init__.py          # App factory
    main.py              # Entry point (uvicorn)
    config.py            # Settings from .env
    models/              # SQLAlchemy ORM + Pydantic schemas
    services/            # Web scraper, Reddit client, collector, exporter, analyzer
    routes/              # Page routes (Jinja2) + API routes (HTMX)
    templates/           # Server-rendered HTML with HTMX
    static/              # CSS design system, JS, images
  tests/                 # pytest suite (scraper + PRAW mocks)
  exports/               # Generated data exports
  .devcontainer/         # GitHub Codespaces (auto-starts app)
  .gitpod.yml            # Gitpod (auto-starts app)
  .github/workflows/     # CI: lint + test on every push/PR
```

### Running tests

```bash
pip install -e ".[dev]"
python -m pytest tests/ -v
```

### Linting

```bash
ruff check app/ tests/
```

### CI

Every push and pull request runs lint + tests across Python 3.10-3.12 via GitHub Actions.

</details>

---

## License

MIT

---

*A Jacob E. Thomas artifact. The waters rise. The Floor holds.*
