# The Threshing Floor

> *The waters rose and the feed became a flood — not of rain, but of noise. Every voice at once, none distinguishable. The signal drowned. The Threshing Floor is the high ground where you bring the harvest and beat it until the grain falls free.*

**Thresh** is a local-first web application for collecting, exploring, and exporting Reddit data. It wraps the Reddit API behind an intuitive browser interface so that anyone — researcher, journalist, civic technologist, curious citizen — can go from "I want to understand what people are saying in r/mentalhealth" to "here's my cleaned, documented dataset" without writing a line of code.

Social media generates an ocean of human expression every day. Most of it washes past unseen. Thresh exists for those who refuse to let the flood carry everything away — who believe that what people say to each other in public forums is worth measuring, preserving, and understanding.

Every export includes a **provenance document**: a complete record of how your data was collected, so your work is reproducible and your methods are transparent. This is the seal on every bundle.

---

## Run It Now

### In the browser (GitHub Codespaces)

Click the button to launch a full development environment in your browser — nothing to install locally:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?hide_repo_select=true&repo=jethomasphd/The_Threshing_Floor)

The Codespace will install dependencies automatically. Once it's ready:

```bash
python -m app.main
```

Codespaces will prompt you to open the forwarded port. Click through and you're on the Floor.

### On your machine

```bash
git clone https://github.com/jethomasphd/The_Threshing_Floor.git
cd The_Threshing_Floor
pip install -r requirements.txt
python -m app.main
```

Open **http://127.0.0.1:8000** in your browser.

### Reddit API credentials

Thresh needs access to Reddit's API to collect data. The app walks you through this on first launch — it takes about five minutes:

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and click **"create another app..."**
2. Set the type to **"script"** and the redirect URI to `http://localhost:8000`
3. Copy the **Client ID** and **Secret** into Thresh's setup form
4. Click **Test Connection**, then **Save & Continue**

That's it. You're on the Floor.

---

## What the Flood Looks Like — and What Thresh Does About It

Reddit generates millions of posts and comments daily. Within that torrent lives real signal: how people talk about mental health, how communities form around crisis, what language shifts when policy changes, where misinformation takes root. But the flood buries it. You can't study what you can't separate.

Thresh is the instrument of separation. It gives you a five-stage workflow, each named for a step in the ancient labor of turning a harvest into something usable:

| Stage | The Work | What You Do |
|-------|----------|-------------|
| **The Floor** | The workspace | Dashboard — recent activity, saved queries, quick actions |
| **Explore** | Scouting the field | Search subreddits by topic, preview posts, check subscriber counts |
| **Thresh** | Beating the grain | Configure and run data collection — sort, time range, keywords, depth |
| **Harvest** | Gathering what fell | Browse your collected data, filter, sort, inspect posts and comments |
| **Winnow** | Wind carries away chaff | Analyze — word frequency, temporal patterns, keyword exploration |
| **Glean** | Bundling clean grain | Export as CSV, JSON, or JSONL, sealed with provenance |

### A typical session

1. **Explore** a topic — search for subreddits, read descriptions, preview sample posts
2. **Thresh** the data — configure a collection (e.g., 500 posts from r/climate, past year, with comments)
3. **Harvest** the results — browse in sortable tables, scan the statistics sidebar
4. **Winnow** the patterns — word clouds, posting frequency over time, keyword co-occurrence
5. **Glean** your dataset — export a ZIP containing your data and `provenance.txt`

The provenance file is the receipt. It records everything: what you asked for, what you got, when, and how. Anyone who reads your work can see exactly how the grain was separated from the chaff.

---

## The Provenance Seal

Every export is a ZIP file containing:

- **Your data** — CSV (Excel-ready, UTF-8 BOM), JSON, or JSONL
- **provenance.txt** — documenting:
  - Tool name and version
  - Reddit API endpoints called
  - Subreddit(s) queried
  - All query parameters (sort, time filter, keywords, limits)
  - Collection timestamp (UTC)
  - Records collected vs. requested
  - Post-collection filters applied
  - Anonymization status and method
  - Citation suggestion

Usernames are anonymized by default (`author_0001`, `author_0002`, ...). You can include real usernames if your work requires it — Thresh will warn you and document the choice in provenance.

---

## Ethics and Privacy

Thresh is built for people who take measurement seriously, which means taking ethics seriously too.

- **Local-first**: All data stays on your machine. Nothing is sent to external servers. Your credentials live in a local `.env` file and are only used to authenticate with Reddit.
- **Anonymization by default**: Usernames are replaced in exports unless you explicitly opt in. Reddit usernames can be traced to real people — Thresh treats this as a responsibility, not an afterthought.
- **Rate-limit respect**: Reddit allows 100 API requests per minute. Thresh tracks your quota in real time with a sidebar gauge and will never exceed the limit.
- **Institutional review**: If your institution requires ethics board approval for social media research, the provenance document provides the methodological transparency you need.
- **Reddit API TOS**: Thresh follows Reddit's [API Terms of Service](https://www.reddit.com/wiki/api/). It is your responsibility to ensure your use of collected data complies with applicable policies and laws.

---

## Configuration

Copy the template or use the in-app setup wizard:

```bash
cp .env.example .env
```

```env
# Reddit API Credentials
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_client_secret_here
REDDIT_USER_AGENT=thresh:v0.1.0 (by /u/your_username)

# App Settings
THRESH_DB_PATH=thresh.db        # SQLite database location
THRESH_EXPORT_DIR=exports       # Where exports are saved
THRESH_DEBUG=false               # Enable debug logging
```

---

## Development

### Project structure

```
The_Threshing_Floor/
  app/
    __init__.py          # App factory
    main.py              # Entry point (uvicorn)
    config.py            # Settings from .env
    models/              # SQLAlchemy ORM + Pydantic schemas
    services/            # Reddit client, collector, exporter, analyzer
    routes/              # Page routes (Jinja2) + API routes (HTMX)
    templates/           # Server-rendered HTML with HTMX
    static/              # CSS, JS, images
  tests/                 # pytest suite with PRAW mocks
  exports/               # Generated data exports
  .devcontainer/         # GitHub Codespaces config
  .github/workflows/     # CI pipeline
```

### Architecture

- **Backend**: FastAPI + Jinja2 + SQLAlchemy/SQLite
- **Frontend**: Server-rendered HTML with HTMX — no build step, no node_modules
- **Styling**: Tailwind CSS (CDN) + custom design system in `thresh.css`
- **Charts**: Chart.js for dashboards, Plotly.js for interactive exploration
- **Database**: SQLite — nothing to install, nothing to configure

### Running tests

```bash
pip install -e ".[dev]"
python -m pytest tests/ -v
```

### Linting

```bash
ruff check app/ tests/
```

---

## CI

Every push and pull request runs the test suite and linter via GitHub Actions. See `.github/workflows/ci.yml`.

---

## Citation

If you use Thresh in published work:

```
Thomas, J. E. (2025). Thresh: The Threshing Floor (Version 0.1.0) [Computer software].
```

Include the version number and collection date. The provenance document in each export contains the exact version used.

---

## The Mythology

You don't need to know any of this to use Thresh. But if you're curious:

The Threshing Floor is part of a lineage of **counter-technologies** — tools built to honor attention rather than exploit it. Its siblings include *The Watchtower* (an instrument for observing digital patterns with intention) and the *COMPANION Protocol* (a framework for ethical human-AI collaboration). Together they form the **Corpus of Self**: artifacts designed for people who refuse to be farmed by the Feed.

The aesthetic you see — dark ground, ember gold, ritualistic composure — is not decoration. It is a statement that someone cared about building this. That attention was paid. Deliberately.

The name *Thresh* comes from the biblical threshing floor, the place where grain was separated from chaff through deliberate labor. Every harvest required it. The Feed is the flood that buries the harvest. Thresh is the high ground.

---

## License

MIT

---

*A Jacob E. Thomas artifact. The waters rise. The Floor holds.*
