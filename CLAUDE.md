# CLAUDE.md — The Threshing Floor

## What This Is

Thresh is a counter-technology. It belongs to the same lineage as The Watchtower and the COMPANION Protocol — tools built by Jacob E. Thomas that honor attention rather than exploit it.

Thresh is a local-first web application for collecting, exploring, and exporting Reddit data. It runs entirely in the browser — no server, no database, no API keys required. Anyone — researcher, journalist, civic technologist, curious citizen — can go from "I want to understand what people are saying in r/mentalhealth" to "here's my cleaned, documented dataset" without writing code.

The name comes from the biblical threshing floor — the place where grain is separated from chaff through deliberate labor. Social media is a flood of noise that buries signal. Thresh is the instrument of separation — the high ground where you bring the harvest and beat it until the grain falls free.

The user may be a scientist, a student, a journalist, or anyone who believes public discourse is worth measuring. They should never need to write code or touch a terminal. Every interaction should feel guided, warm, and defensible. The aesthetic is atmospheric but the interface is clear.

## The Metaphor System

These names appear throughout the codebase, UI, and navigation. Every page has both its metaphor name and a plain subtitle so the user is never lost.

| Metaphor | Meaning | Page/Function |
|----------|---------|---------------|
| **The Floor** | The workspace, the central place of labor | Dashboard — recent activity, saved queries, quick-start |
| **Explore** | Scouting the field before harvest | Subreddit discovery and preview |
| **Thresh** | Beating the grain — collection and separation | Data collection configuration and execution |
| **Harvest** | Gathering what was threshed | Results viewing, filtering, basic statistics |
| **Winnow** | The wind that carries away chaff | Analysis — word frequency, temporal patterns, keywords |
| **Glean** | Gathering cleaned grain into bundles | Export with provenance documentation + AI research report generation |
| **Provenance** | The seal on every bundle | Methodology sidecar (replaces generic "metadata") |

## Architecture (Do Not Deviate)

- **Platform**: Cloudflare Pages static site. NO backend server, NO database, NO build step.
- **Frontend**: Single-page app in `public/index.html`. Vanilla JavaScript. NO React, NO Vue, NO bundler, NO node_modules.
- **Styling**: Tailwind CSS via CDN + custom CSS in `public/css/thresh.css`
- **Icons**: Lucide via CDN
- **Interactivity**: Vanilla JS for all UI (hash-based routing in `app.js`). NO frameworks.
- **Data source**: Reddit's public JSON endpoints via Cloudflare Pages Function proxy (`functions/api/reddit.js`)
- **AI integration**: Claude Opus 4.6 via dedicated Cloudflare Worker (`thresh-proxy/`) for managed mode, or Cloudflare Pages Function proxy (`functions/api/claude.js`) for BYOK mode. User-provided keys take priority over managed proxy.
- **DOCX export**: Research reports export as formatted Word documents via docx.js (CDN). Markdown and clipboard copy also available.
- **Storage**: Browser `localStorage` only. No server database.
- **Runs with**: `npx wrangler pages dev public` (local) or deploy to Cloudflare Pages (production)

## Code Conventions

### HTML
- Single-page app in `public/index.html`
- Semantic HTML5, accessible (labels, alt text, keyboard navigation)
- Sections shown/hidden via hash-based routing in `app.js`

### CSS
- Tailwind utilities via CDN for layout/spacing
- Custom properties in `public/css/thresh.css` for the design system
- Inline styles only for dynamic JS-computed values

### JavaScript
- Vanilla JS only. ES6+. No jQuery. No frameworks.
- All JS in `public/js/`, loaded with defer
- `app.js` — Router, state management, UI orchestration
- `reddit.js` — Reddit JSON fetching via CORS proxy, rate limiting
- `exporter.js` — CSV/JSON export + provenance ZIP generation
- `claude.js` — Optional Claude API integration (analysis + research reports)

### Cloudflare Pages Functions
- `functions/api/reddit.js` — Stateless CORS proxy for Reddit public JSON
- `functions/api/claude.js` — Stateless proxy for Anthropic API calls

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
- Track via Reddit's response headers (`x-ratelimit-remaining`, `x-ratelimit-reset`)
- Cache rate limit state in `localStorage` (key: `thresh_rate_limit`)
- Show remaining quota in a sidebar sentinel widget (ember gauge that dims as quota depletes)
- Disable collection buttons when cooldown is active
- Never allow unbounded API calls

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

### public/index.html
Single-page application shell. Includes: Google Fonts (Cormorant Garamond, IBM Plex Sans, IBM Plex Mono), Lucide CDN, JSZip CDN, docx.js CDN, Chart.js CDN. Navigation sidebar with six pages (Floor, Thresh, Harvest, Winnow, Glean, About). Mobile bottom navigation with all six pages. Toast container. Grain texture overlay. Cinematic intro sequence. Footer with version.

### public/js/app.js
Core application: hash-based router, state management (`collections[]`, `activeCollection`), UI orchestration for all pages. Persistence via `localStorage`. Includes the AI Research Report generation logic (`generateResearchReport`, `downloadReportDocx`, `downloadReport`, `copyReport`). DOCX generation via docx.js with Markdown-to-DOCX conversion (`_parseMarkdownBlocks`, `_renderInlineRuns`).

### public/js/reddit.js
Reddit data fetching via the Cloudflare CORS proxy. Handles rate limiting (tracks `x-ratelimit-*` headers), exponential backoff on 429 responses, and comment tree expansion.

### public/js/exporter.js
Client-side export engine. Generates CSV (UTF-8 BOM for Excel) or JSON, bundles with `provenance.txt` in a ZIP via JSZip. Handles username anonymization.

### public/js/claude.js
Claude API integration supporting two modes:
- **Managed proxy mode** — `MANAGED_PROXY_URL` points to the `thresh-proxy` Cloudflare Worker; no user API key needed
- **BYOK mode** — User provides their own Anthropic API key; sent to `/api/claude` Pages Function
- User-provided keys take priority over managed proxy
- `analyze()` — Winnow page analysis (themes, sentiment, summary, questions, custom prompt)
- `generateReport()` — Glean page research report generator (full Intro/Methods/Results/Discussion document)

### functions/api/reddit.js
Cloudflare Pages Function. Stateless CORS proxy that forwards requests to Reddit's public JSON endpoints. No logging, no data storage.

### functions/api/claude.js
Cloudflare Pages Function. Stateless BYOK proxy for Anthropic API calls. Receives the user's API key per-request. Uses Claude Opus 4.6. No logging, no key storage.

### thresh-proxy/
Dedicated Cloudflare Worker for managed AI proxy mode. Stores the Anthropic API key as a Cloudflare secret. Uses Claude Opus 4.6 (`claude-opus-4-6`) with 8192 max tokens. See `thresh-proxy/SETUP.md` for deployment instructions.

## Testing
- Manual testing via `npx wrangler pages dev public` (local Cloudflare Pages emulation)
- Verify export compliance (CSV parseable, JSON valid, provenance.txt present in ZIP)
- Verify DOCX export opens correctly in Word/Google Docs
- Test rate limit gauge behavior under throttled conditions
- Test AI features with managed proxy or a valid Anthropic API key
- Test mobile navigation (all 6 pages accessible via bottom nav)

## What Success Looks Like

Someone opens the live site (or clones the repo and runs `npx wrangler pages dev public`), and within five minutes is exploring subreddits and collecting their first dataset. When they export, anyone reviewing the work sees exactly how the data was collected. Provenance.txt gives them the language they need for a methods section, a transparency report, or a replication attempt. The AI Research Report takes it further — generating a full Introduction/Methods/Results/Discussion document from a single collection and a good research question.

The tool respects their time, respects Reddit's API, and produces defensible output. The aesthetic tells them that someone cared about building this — that it wasn't thrown together, that attention was paid. That's the point of the whole mythology: attention, paid deliberately.
