# CLAUDE.md — The Threshing Floor

## What This Is

Thresh is a counter-technology. It belongs to the same lineage as The Watchtower and the COMPANION Protocol — tools built by Jacob E. Thomas that honor attention rather than exploit it.

Specifically, Thresh is a local-first web application that helps a graduate student collect, explore, and export Reddit data for her dissertation research. It wraps PRAW (Python Reddit API Wrapper) behind an intuitive browser interface so she can go from "I want to study r/mentalhealth discourse" to "here's my cleaned, documented dataset" without writing code.

The name comes from the biblical threshing floor — the place where grain is separated from chaff through deliberate labor. The Feed buries signal under noise. Thresh is the instrument of separation.

The user is a graduate student. She may know some Python but should never need to touch it. Every interaction should feel guided, warm, and academically defensible. The aesthetic is atmospheric but the interface is clear.

## The Metaphor System

These names appear throughout the codebase, UI, and navigation. Every page has both its metaphor name and a plain subtitle so the student is never lost.

| Metaphor | Meaning | Page/Function |
|----------|---------|---------------|
| **The Floor** | The workspace, the central place of labor | Dashboard — recent activity, saved queries, quick-start |
| **Explore** | Scouting the field before harvest | Subreddit discovery and preview |
| **Thresh** | Beating the grain — collection and separation | Data collection configuration and execution |
| **Harvest** | Gathering what was threshed | Results viewing, filtering, basic statistics |
| **Winnow** | The wind that carries away chaff | Analysis — word frequency, temporal patterns, keywords |
| **Glean** | Gathering cleaned grain into bundles | Export with provenance documentation |
| **Provenance** | The seal on every bundle | Methodology sidecar (replaces generic "metadata") |

## Architecture (Do Not Deviate)

- **Backend**: FastAPI + Jinja2 templates + SQLAlchemy/SQLite
- **Frontend**: Server-rendered HTML with HTMX. NO React, NO Vue, NO build step, NO node_modules.
- **Styling**: Tailwind CSS via CDN + custom CSS in `app/static/css/thresh.css`
- **Charts**: Chart.js for widgets, Plotly.js for interactive exploration
- **Icons**: Lucide via CDN
- **Interactivity**: HTMX handles all dynamic updates. Vanilla JS only for charts and minor UI.
- **Database**: SQLite via SQLAlchemy. No Postgres, no Docker-required databases.
- **Runs with**: `pip install -r requirements.txt && python -m app.main`

## Code Conventions

### Python
- Python 3.10+, type hints on all function signatures
- Pydantic v2 for all request/response schemas
- SQLAlchemy 2.0 style (mapped_column)
- f-strings, pathlib.Path, Google-style docstrings
- `logging` module, not print statements
- Ruff for linting

### HTML/Templates
- Jinja2 with inheritance from `base.html`
- HTMX attributes for all dynamic behavior (`hx-get`, `hx-post`, `hx-target`, `hx-swap`)
- Partials in `app/templates/partials/` as HTMX swap targets
- Semantic HTML5, accessible (labels, alt text, keyboard navigation)

### CSS
- Tailwind utilities for layout/spacing
- Custom properties in `thresh.css` for the design system
- No inline styles except dynamic Jinja2 values

### JavaScript
- Vanilla JS only. ES6+. No jQuery.
- Chart.js and Plotly.js initialized via data attributes
- All JS in `app/static/js/`, loaded with defer

## Design Language

### Personality
This is a Jacob E. Thomas artifact. Dark ground, ember gold, intentional typography, ritualistic composure. But it serves someone who didn't sign up for mysticism — atmospheric, not opaque. The metaphors orient; the interface clarifies.

### Colors (CSS custom properties in thresh.css)
```css
--ground: #0A0A0F;
--surface: #131318;
--surface-raised: #1A1A22;
--ember: #C9A227;
--ember-dim: #8B7121;
--ember-glow: #E8C547;
--ash: #6B6B7B;
--smoke: #3D3D4A;
--bone: #E8E4DC;
--bone-muted: #A8A49C;
--success: #4A9B6E;
--warning: #D4943A;
--error: #C44B4B;
--link: #7BA3C9;
--link-hover: #A8C8E8;
```

### Typography
- **Display** (page titles, sigil): Cormorant Garamond — the ritual voice
- **Body** (UI text, descriptions): IBM Plex Sans — the working voice
- **Data** (tables, code, API output): IBM Plex Mono — the data voice
- Base: 16px, body line-height: 1.6, heading line-height: 1.15

### Visual Language
- **The Sigil**: Stylized threshing floor glyph (circle + crossed grain stalks). SVG, ember gold. Appears in nav header, loading states, export watermark.
- **Borders**: 1px solid rgba(201, 162, 39, 0.15) — ember at low opacity
- **Dividers**: Smoke color. Key breaks in ember at 30%
- **Shadows**: Rare. 0 4px 24px rgba(0,0,0,0.5) — deep, diffuse
- **Radius**: 4px inputs/buttons, 8px cards, 2px table cells
- **Focus/Active**: Ember glow ring — box-shadow: 0 0 0 2px rgba(201,162,39,0.3)
- **Background atmosphere**: Subtle CSS grain overlay at 2-3% opacity on ground
- **Scrollbar**: Custom — thin, smoke track, ember thumb on hover

### Component Patterns
- **Cards**: surface bg, ember-tinted border, 8px radius. Hover: border brightens.
- **Primary buttons**: ember bg, ground text, glow on hover.
- **Tables**: surface bg, smoke dividers, bone_muted uppercase headers. Data in Plex Mono. Alternating surface/surface_raised rows.
- **Inputs**: surface_raised bg, smoke border, bone text. Focus: ember glow ring.
- **Labels**: bone_muted, Plex Sans, 0.8125rem, uppercase, tracked.
- **Navigation**: ground bg sidebar, fixed left. Active: 3px ember left border, surface_raised bg. Header: sigil + "The Threshing Floor" in Cormorant, ember.
- **Empty states**: Sigil at 40% opacity, Cormorant heading, Plex Sans description, primary CTA.
- **Loading**: Rotating sigil (ember gold, subtle pulse) or skeleton screens (surface_raised shimmer).
- **Toasts**: surface_raised bg, 3px left border by type. Slide top-right, dismiss 4s.

## Critical Behaviors

### Rate Limiting
Reddit allows 100 requests/minute. Thresh MUST:
- Track via PRAW's built-in limiter plus internal counter
- Cache subreddit metadata in SQLite (TTL: 15 min)
- Show remaining quota in a sidebar sentinel widget (ember gauge that dims as quota depletes)
- Never allow unbounded API calls
- Use `replace_more(limit=N)` with sensible defaults, never `limit=None`

### Provenance (Non-Negotiable)
Every export MUST include `provenance.txt` documenting:
- Tool name and version
- Reddit API endpoint(s) used
- Subreddit(s) queried
- Query parameters (sort, time filter, keyword, max results)
- Date/time of collection (UTC)
- Records collected vs. requested
- Post-collection filters applied
- Rate limit or truncation notes

This is the seal on every bundle. Academic reproducibility depends on it.

### Privacy & Ethics
- Never store Reddit passwords or OAuth tokens beyond session
- About page includes: re-identification risks, IRB guidance, Reddit API TOS, ethical data handling
- Default exports anonymize usernames (option to include, with warning)
- Include citation suggestion for the tool

### Error Handling
- Reddit API errors: human-readable messages, not stack traces
- Invalid credentials: guide back to setup flow
- Rate limit exceeded: countdown timer, disable collection buttons
- Network errors: graceful degradation, explain, offer retry

## File-Level Guidance

### app/services/reddit_client.py
Core PRAW interface. Wrap all calls in try/except. Methods return Pydantic models, never raw PRAW objects:
- `search_subreddits(query, limit) -> list[SubredditInfo]`
- `get_subreddit_meta(name) -> SubredditDetail`
- `get_posts(subreddit, sort, time_filter, limit, query) -> list[PostData]`
- `get_comments(post_id, depth, limit) -> list[CommentData]`
- `get_rate_limit_status() -> RateLimitInfo`

### app/services/collector.py
Orchestrates multi-step collection: pagination beyond 1000-item limit (created_utc windowing), progress tracking (CollectionJob in SQLite), comment tree expansion, deduplication.

### app/services/exporter.py
Transforms data into formats: CSV (UTF-8 BOM for Excel), JSON (pretty), JSONL (streaming). All wrapped in ZIP with provenance.txt.

### app/templates/base.html
Layout shell. Must include: Google Fonts (Cormorant Garamond, IBM Plex Sans, IBM Plex Mono), Tailwind CDN, HTMX CDN, Chart.js CDN, Lucide CDN. Navigation sidebar with all seven pages (Floor, Explore, Thresh, Harvest, Winnow, Glean, About). Toast container. Grain texture overlay. Footer with version.

## Testing
- pytest + httpx.AsyncClient for routes
- Mock PRAW with fixture JSON in `tests/fixtures/`
- Test services independently from API
- Validate export compliance (CSV parseable, JSON valid, provenance.txt present)
- Every service function: one happy-path + one error-path test minimum

## What Success Looks Like

She clones the repo, runs pip install, walks through the credential setup, and within ten minutes is exploring subreddits and collecting her first dataset. When she exports, her advisor sees exactly how the data was collected. When she writes her methods chapter, provenance.txt gives her the language she needs.

The tool respects her time, respects Reddit's API, and produces academically defensible output. The aesthetic tells her that someone cared about building this — that it wasn't thrown together, that attention was paid. That's the point of the whole mythology: attention, paid deliberately.
