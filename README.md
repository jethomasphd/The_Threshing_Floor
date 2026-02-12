# The Threshing Floor

**Separate the wheat from the feed.**

Thresh is a local-first web application that helps graduate researchers collect, explore, and export Reddit data for dissertation work — without writing code. It wraps the Reddit API behind an intuitive browser interface so you can go from "I want to study r/mentalhealth discourse" to "here's my cleaned, documented dataset" in minutes.

Every export includes a **provenance document** detailing exactly how your data was collected, so your methods chapter practically writes itself.

---

## Quick Start

### Prerequisites

- **Python 3.10+** ([python.org](https://www.python.org/downloads/))
- **A Reddit account** (to create API credentials)

### 1. Clone and install

```bash
git clone https://github.com/jethomasphd/The_Threshing_Floor.git
cd The_Threshing_Floor
pip install -r requirements.txt
```

### 2. Run the app

```bash
python -m app.main
```

Open your browser to **http://127.0.0.1:8000**

### 3. Set up Reddit API credentials

On your first visit, Thresh will guide you through connecting to Reddit's API. Here's what to expect:

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and click **"create another app..."**
2. Fill in:
   - **Name**: anything you like (e.g., `thresh-research`)
   - **Type**: select **"script"**
   - **Redirect URI**: `http://localhost:8000`
3. Click "create app" — you'll see your **Client ID** (short string under the app name) and **Secret**
4. Enter these on the **About** page in Thresh and click **Test Connection**
5. Once validated, click **Save & Continue**

That's it. You're on the Floor.

---

## The Workflow

Thresh guides you through five stages, each named from the threshing metaphor:

| Page | Name | What You Do |
|------|------|-------------|
| **The Floor** | Dashboard | See recent activity, saved queries, quick-start actions |
| **Explore** | Find Subreddits | Search subreddits by topic, preview posts, check metadata |
| **Thresh** | Collect Data | Configure and run data pulls — sort, time range, keywords, comments |
| **Harvest** | View Results | Browse collected data in sortable tables with stats and charts |
| **Winnow** | Analyze | Word frequency, temporal patterns, keyword tracking |
| **Glean** | Export | Download CSV/JSON/JSONL with provenance documentation |

### Typical session

1. **Explore** — search for subreddits related to your research topic
2. **Thresh** — configure a collection (e.g., top 200 posts from r/anxiety, past year, with comments)
3. **Harvest** — browse and filter your collected data, check the stats sidebar
4. **Winnow** — look at word frequencies and temporal patterns
5. **Glean** — export as CSV with anonymized usernames, download the ZIP

The ZIP contains your data file plus `provenance.txt` — a complete record of how the data was collected, ready for your methods chapter.

---

## What's in the Export

Every export is a ZIP file containing:

- **Your data** in CSV, JSON, or JSONL format
- **provenance.txt** documenting:
  - Tool name and version
  - Reddit API endpoints used
  - Subreddit(s) queried
  - Query parameters (sort, time filter, keywords, limits)
  - Date/time of collection (UTC)
  - Records collected vs. requested
  - Post-collection filters applied
  - Anonymization status
  - Citation suggestion

CSV files include a UTF-8 BOM header for clean opening in Excel. Usernames are anonymized by default (e.g., `author_0001`), with an option to include real usernames if your IRB approves.

---

## Project Structure

```
The_Threshing_Floor/
  app/
    __init__.py          # App factory
    main.py              # Entry point
    config.py            # Settings (loads .env)
    models/
      database.py        # SQLAlchemy engine + session
      schemas.py         # Pydantic models
      tables.py          # ORM models (jobs, posts, comments, exports)
    services/
      reddit_client.py   # PRAW wrapper with rate limiting
      cache.py           # SQLite response cache
      collector.py       # Data collection orchestrator
      exporter.py        # CSV/JSON/JSONL export with provenance
      analyzer.py        # Word frequency, temporal analysis
    routes/
      pages.py           # Page routes (Jinja2 templates)
      api.py             # HTMX API endpoints
    templates/            # Jinja2 templates (28 files)
    static/
      css/thresh.css     # Design system
      js/                # Toast system, charts, analysis
      img/               # Sigil SVG, favicon
  tests/                 # pytest suite
  exports/               # Where your data exports land
  .env.example           # Credential template
```

---

## Configuration

Copy `.env.example` to `.env` and fill in your credentials (or use the in-app setup wizard):

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
THRESH_DEBUG=false               # Enable debug mode
```

---

## Running Tests

```bash
pip install -e ".[dev]"
python -m pytest tests/ -v
```

---

## Ethical Considerations

- **Re-identification**: Reddit usernames can be traced to real people. Exports anonymize usernames by default.
- **IRB**: If your institution requires IRB approval for social media research, the provenance document provides the methodological transparency you need. Consult your advisor before collecting data.
- **Rate limits**: Thresh respects Reddit's 100-requests-per-minute limit and tracks your quota in real time.
- **Local-first**: All data stays on your machine. Credentials are stored in `.env` and never leave your computer beyond Reddit's auth endpoint.

---

## Citation

If you use Thresh in your research:

```
Thomas, J. E. (2025). Thresh: The Threshing Floor (Version 0.1.0) [Computer software].
```

---

## License

MIT

---

*Thresh is a Jacob E. Thomas artifact — part of a lineage of counter-technologies that honor attention rather than exploit it.*
