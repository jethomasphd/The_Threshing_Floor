#!/usr/bin/env node
/**
 * build_manuscript.js — Typesets the preprint as a Word document.
 *
 *   Input : ../results/stats.json   (every number in the prose comes from here)
 *           ../results/figures/*.png
 *           ../data/protocol/sampling_frame.csv
 *           ./fonts/*.ttf           (IBM Plex Sans / Mono, Cormorant Garamond — SIL OFL; embedded)
 *   Output: ../Thomas_2026_The_Threshing_Floor_preprint.docx
 *
 * No number in the manuscript is hand-typed: re-run the analysis and rebuild,
 * and the text follows the data.
 *
 * Usage:  cd preprint/manuscript && npm install && node build_manuscript.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, BorderStyle, WidthType, ShadingType, PageNumber, TabStopType, HeadingLevel,
  VerticalAlign, ExternalHyperlink, LevelFormat, TableLayoutType,
} = require('docx');

const HERE = __dirname;
const PRE = path.resolve(HERE, '..');
const OUT = path.join(PRE, 'Thomas_2026_The_Threshing_Floor_preprint.docx');
const STATS = JSON.parse(fs.readFileSync(path.join(PRE, 'results/stats.json'), 'utf8'));
const C = STATS.collections[STATS.primary];
const TV = STATS.tool_verification;
const A = C.audit, G = C.governance, E = C.engagement, T = C.temporal, SRC = C.sources, P = C.participation,
  FS = C.framing_sentiment, L = C.language_duplication;

// ------------------------------------------------------------------ format --
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = x => Number(x).toLocaleString('en-US');
const dec = (x, d = 2) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
const pval = p => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const hourLabel = h => `${String(h).padStart(2, '0')}:00`;
const frame = k => FS.frames[k];
const kSum = Object.values(STATS.sampling_frame).reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ design --
const FONT = 'IBM Plex Sans';
const FONT_SB = 'IBM Plex Sans SmBld';
const MONO = 'IBM Plex Mono';
const DISPLAY = 'Cormorant Garamond SemiBold';
const INK = '23232B', MUTED = '6B6B7B', EMBER = 'B08A1E', EMBER_DK = '7A6118', RULE = 'C9B98A',
  WASH = 'F8F4E8', ZEBRA = 'FBFAF6', LINK = '2F6DB0';
const BODY = 19;                 // half-points (9.5 pt)
const PAGE_W = 12240, MARGIN = 1296, CONTENT_W = PAGE_W - 2 * MARGIN;   // 0.9" margins → 6.7" text block
const IMG_W = 643;               // px at 96 dpi ≈ 6.7 in

// ------------------------------------------------------- inline markup ------
// **bold**  *italic*  ‹mono›  — parsed into TextRuns.
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|‹[^›]+›)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), ...base, font: FONT_SB }));
    else if (tok.startsWith('*')) out.push(new TextRun({ text: tok.slice(1, -1), ...base, italics: true }));
    else out.push(new TextRun({ text: tok.slice(1, -1), ...base, font: MONO, size: (base.size || BODY) - 2 }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

const para = (text, o = {}) => new Paragraph({
  children: runs(text, o.run || {}),
  spacing: { after: o.after ?? 100, before: o.before ?? 0, line: o.line ?? 264 },
  alignment: o.align ?? AlignmentType.JUSTIFIED,
  indent: o.indent, keepNext: o.keepNext, keepLines: o.keepLines,
});

let h1n = 0, h2n = 0;
const H1 = title => { h1n += 1; h2n = 0; return new Paragraph({
  heading: HeadingLevel.HEADING_1, keepNext: true,
  children: [new TextRun({ text: `${h1n}`, color: EMBER, font: FONT_SB, size: 24 }), new TextRun({ text: ` ${title}` })],
}); };
const H1u = title => new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new TextRun(title)] });
const H2 = title => { h2n += 1; return new Paragraph({
  heading: HeadingLevel.HEADING_2, keepNext: true,
  children: [new TextRun({ text: `${h1n}.${h2n} `, color: EMBER_DK }), new TextRun({ text: title })],
}); };

function figure(file, n, caption, widthPx = IMG_W) {
  const buf = fs.readFileSync(path.join(PRE, 'results/figures', file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);           // PNG IHDR
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: 'png', data: buf, transformation: { width: widthPx, height: Math.round(widthPx * h / w) },
        altText: { title: `Figure ${n}`, description: caption.replace(/\*|‹|›/g, ''), name: `Figure ${n}` } })] }),
    new Paragraph({ spacing: { after: 200, line: 240 }, alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: `Figure ${n}. `, font: FONT_SB, size: 16, color: INK }), ...runs(caption, { size: 16, color: '3A3A44' })] }),
  ];
}

// ------------------------------------------------------------------ tables --
const border0 = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const ruleB = (sz = 6, color = RULE) => ({ style: BorderStyle.SINGLE, size: sz, color });

function table(n, caption, headers, rows, widthsIn, opts = {}) {
  const totalIn = widthsIn.reduce((a, b) => a + b, 0);
  const widths = widthsIn.map(w => Math.round(w / totalIn * CONTENT_W));
  widths[widths.length - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
  const fs_ = opts.size || 15;
  const cell = (text, i, { head = false, zebra = false, last = false, first = false, group = false } = {}) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: head ? WASH : group ? 'F1ECDD' : zebra ? ZEBRA : 'FFFFFF' },
    margins: { top: 45, bottom: 45, left: 80, right: 80 },
    verticalAlign: VerticalAlign.TOP,
    columnSpan: group ? headers.length : undefined,
    borders: {
      top: head ? ruleB(10, EMBER) : border0, left: border0, right: border0,
      bottom: head ? ruleB(6, EMBER) : last ? ruleB(10, EMBER) : ruleB(2, 'E6E1D3'),
    },
    children: [new Paragraph({ spacing: { after: 0, line: 228 }, alignment: AlignmentType.LEFT,
      children: runs(String(text), head ? { size: fs_, font: FONT_SB, color: INK } :
        { size: fs_, color: INK, ...(group ? { font: FONT_SB, color: EMBER_DK } : {}) }) })],
  });
  const trs = [new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, i, { head: true })) })];
  rows.forEach((r, ri) => {
    const last = ri === rows.length - 1;
    if (r.group) trs.push(new TableRow({ cantSplit: true, children: [cell(r.group, 0, { group: true, last })] }));
    else trs.push(new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, { zebra: ri % 2 === 1, last })) }));
  });
  const cap = new Paragraph({ keepNext: true, spacing: { before: 160, after: 70, line: 240 }, alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: `Table ${n}. `, font: FONT_SB, size: 16, color: INK }), ...runs(caption, { size: 16, color: '3A3A44' })] });
  const tbl = new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: trs });
  const out = [cap, tbl];
  if (opts.note) out.push(new Paragraph({ spacing: { before: 50, after: 200, line: 228 }, alignment: AlignmentType.JUSTIFIED,
    children: runs(opts.note, { size: 14, color: MUTED }) }));
  else out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}

// ============================================================ CONTENT ========
const kids = [];
const add = (...xs) => xs.flat().forEach(x => kids.push(x));

// ---------------------------------------------------------------- title -----
add(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 120 }, children: [
  new ImageRun({ type: 'png', data: fs.readFileSync(path.join(HERE, 'sigil.png')), transformation: { width: 38, height: 38 },
    altText: { title: 'Thresh sigil', description: 'The Threshing Floor sigil: two overlapping squares around a grain stalk', name: 'sigil' } }),
]}));
add(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'PREPRINT  ·  RESEARCH SOFTWARE & METHODS  ·  v1.0  ·  29 SEPTEMBER 2026',
  font: FONT_SB, size: 14, color: EMBER, characterSpacing: 30 })] }));
add(new Paragraph({ spacing: { before: 0, after: 0, line: 240 }, children: [new TextRun({ text: ' ', size: 14 })] }));
add(new Paragraph({ spacing: { before: 60, after: 60, line: 380 }, children: [new TextRun({ text: 'Carrying the Harvest by Hand', font: DISPLAY, size: 56, color: INK })] }));
add(new Paragraph({ spacing: { after: 220, line: 290 }, children: [new TextRun({
  text: 'The Threshing Floor, a provenance-first, human-in-the-loop instrument for studying public Reddit discourse — with a worked example from r/politics in the first weeks of the 2026 Iran war',
  font: 'Cormorant Garamond', italics: true, size: 30, color: '3A3A44' })] }));
add(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: 'Jacob E. Thomas, PhD', font: FONT_SB, size: 20, color: INK })] }));
add(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: 'Independent researcher · Austin, Texas, USA', size: 17, color: MUTED })] }));
add(new Paragraph({ spacing: { after: 200 }, children: [
  new TextRun({ text: 'Correspondence: ', size: 17, color: MUTED }),
  new ExternalHyperlink({ link: 'mailto:jethomasphd@gmail.com', children: [new TextRun({ text: 'jethomasphd@gmail.com', size: 17, color: LINK })] }),
  new TextRun({ text: '  ·  Software: ', size: 17, color: MUTED }),
  new ExternalHyperlink({ link: 'https://github.com/jethomasphd/The_Threshing_Floor', children: [new TextRun({ text: 'github.com/jethomasphd/The_Threshing_Floor', size: 17, color: LINK })] }),
] }));

// ---------------------------------------------------------------- abstract --
const absPara = (label, text) => new Paragraph({ spacing: { after: 70, line: 252 }, alignment: AlignmentType.JUSTIFIED,
  children: [new TextRun({ text: `${label}  `, font: FONT_SB, size: 17, color: EMBER_DK }), ...runs(text, { size: 17 })] });
const abstract = [
  new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: 'ABSTRACT', font: FONT_SB, size: 15, color: EMBER_DK, characterSpacing: 40 })] }),
  absPara('Background.', 'Researchers who study public discourse on Reddit have lost most of their routes to the data. API repricing (2023), a contract-only Public Content Policy (2024), and the blocking of automated requests from datacenter networks leave non-specialists choosing between institutional data programs, contested archives, and scraping.'),
  absPara('Instrument.', 'The Threshing Floor (Thresh) is a free, open-source, browser-only instrument that inverts the collection pipeline. Thresh builds the exact Reddit ‹.json› URL for a query; the researcher opens it in their own browser and pastes the result back; parsing, analysis, and export happen client-side. Every export is sealed with a provenance record. No Thresh server touches Reddit data and no credentials are required.'),
  absPara('Worked example.', `We analyze a Thresh export of the top ${A.posts_observed} r/politics posts mentioning Iran in the 30 days to 20 March 2026 (${num(A.comments_observed)} comments), situated within a pre-specified ${kSum}-community sampling frame for studying war discourse under moderation and influence-operation constraints.`),
  absPara('Results.', `Provenance made the sample’s shape auditable. The export held ${pct(A.coverage_overall)} of the ${num(A.reported_comments_total)} comments Reddit reported; AutoModerator wrote the first comment in every thread; commenting followed a North American day (${pct(T.overnight_share_01_06_et)} of comments between 01:00 and 06:59 Eastern versus ${pct(T.overnight_share_if_uniform, 0)} under uniformity). Partisan and leadership framing (${pct(frame('Partisan & leadership').share)} of comments) outweighed every war-substantive frame; sentiment was negative (mean VADER ${dec(FS.vader_mean)}) and showed no trend. No Persian- or Spanish-language content and no coordinated duplication were detected. A harness executing Thresh’s own code showed its pseudonyms are deterministic—enabling cross-community linkage—and reversible by dictionary, a limitation we disclose.`),
  absPara('Conclusion.', 'Human-in-the-loop collection trades scale for legitimacy and transparency. For bounded, question-driven studies of public discourse, the trade is favorable, provided moderation and ranking are treated as part of the data.'),
  new Paragraph({ spacing: { before: 40, after: 0 }, children: [new TextRun({ text: 'Keywords  ', font: FONT_SB, size: 15, color: EMBER_DK }),
    new TextRun({ text: 'Reddit · computational social science · research software · data provenance · human-in-the-loop · content moderation · information operations · 2026 Iran war', size: 15, color: '3A3A44' })] }),
];
add(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W], rows: [new TableRow({ children: [new TableCell({
  width: { size: CONTENT_W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: WASH },
  margins: { top: 160, bottom: 160, left: 220, right: 220 },
  borders: { top: border0, bottom: border0, right: border0, left: { style: BorderStyle.SINGLE, size: 24, color: EMBER } },
  children: abstract })] })] }));
add(new Paragraph({ spacing: { after: 120 }, children: [] }));

// ================================================================ 1 =========
add(H1('Introduction'));
add(para('Reddit is unusual among large platforms: it is organized into tens of thousands of topical communities, it is public by default, and its unit of speech is text. For more than a decade those properties made it one of the most studied sources in computational social science, public health, and communication research (Medvedev et al., 2019; Proferes et al., 2021), and for most of that decade the free API and the Pushshift archive (Baumgartner et al., 2020) put the data within reach of anyone who could write a script.'));
add(para('That period has ended. Freelon (2018) named the “post-API age” and Bruns (2019) the “APIcalypse”; Reddit has since provided a textbook case. In 2023 the company moved to charge for API access (Isaac, 2023); in 2024 its Public Content Policy made bulk access contractual (Perez, 2024), with non-commercial academic access routed through a Reddit for Researchers program open to accredited-university researchers with ethics approval (Reddit, 2026). By 2026 Reddit was also refusing automated requests for its public ‹.json› pages from datacenter networks. We observed this directly: the server relay in version 1 of the instrument described here began receiving HTTP 403 and 429 responses from cloud IP ranges, and a request issued from a cloud container while preparing this paper was likewise refused.'));
add(para('The researchers left outside are not marginal. They are journalists on deadline, public-health practitioners, students, civic technologists, and scholars without an accredited-university affiliation—exactly the people for whom “what are people saying in this community?” is a practical question. The routes that remain open to them are often the least defensible: residential-proxy scraping and IP rotation defeat a platform’s stated wishes and put the legitimacy of any finding at risk.'));
add(para('This paper describes The Threshing Floor (Thresh), an instrument built for that gap, and makes five contributions. **(i)** A design: *human-in-the-loop collection*, which returns the network request to a person using an ordinary browser, and an account of what that design gives up and gains. **(ii)** Provenance as a first-class output rather than an afterthought. **(iii)** A study design for contested discourse, developed for research on the 2026 Iran war, that pre-specifies a multi-community sampling frame and treats community governance as data. **(iv)** A worked example on a real Thresh export, analyzed with a pipeline in which every number is regenerated from the data. **(v)** A verification harness that executes the instrument’s own code, and a candid list of limitations it surfaced. The name is literal: a threshing floor is where grain is separated from chaff by deliberate labor. The instrument is built on the premise that attention, paid deliberately, is a methodological virtue.'));

// ================================================================ 2 =========
add(H1('Background'));
add(H2('Routes to Reddit data in 2026'));
add(para('Table 1 summarizes the routes available at the time of writing. They differ less in the data they return—the underlying objects are the same—than in who performs the request, under what authority, and what record of the request survives.'));
add(table(1, 'Routes to public Reddit data in 2026, compared on the dimensions that matter for defensible research.',
  ['Route', 'Who makes the request', 'Credentials / gatekeeping', 'Scale', 'What survives for reviewers'],
  [
    ['Official Data API', 'Registered application (server)', 'OAuth app; rate limits; commercial terms for volume', 'High', 'Code and API logs, if kept'],
    ['Reddit for Researchers', 'Reddit, on approval', 'Accredited university; IRB/ethics letter; application', 'High', 'Programme documentation'],
    ['Third-party archives / dumps', 'An archive operator, historically', 'Varies; policy status contested since 2023', 'Very high, historical', 'Depends on the archive'],
    ['Automated scraping', 'Researcher’s server or script', 'None; datacenter IPs blocked; ToS exposure', 'High, fragile', 'Rarely documented'],
    ['**Thresh v2 (this paper)**', '**The researcher’s own browser**', '**None; public pages only, at human pace**', '**Bounded (≤100 posts/page; ≤500/collection)**', '**Exact URL, counts, UTC time and method in** ‹provenance.txt›'],
  ], [1.25, 1.3, 1.6, 0.95, 1.6]));
add(H2('What Reddit data can and cannot answer'));
add(para('Reddit users are not a sample of any general population. In 2025, 26% of U.S. adults reported using Reddit; use was far higher among adults under 30 (48%) and among college graduates (about four in ten) than among older or less-educated adults, higher among men, and higher among Democrats (32%) than Republicans (22%) (Gottfried & Park, 2025). Within the platform, those who post are a small minority of those who read. Reddit data therefore cannot estimate the attitudes of Iranians, Iranian-Americans, or Americans. What it can support are questions about *framing*, *shifts over time*, *comparison across communities*, and *narrative propagation*—claims about what is said, where, and how, rather than about what a population believes.'));
add(H2('Governance is part of the data'));
add(para('Every subreddit is a governed space. Sidebar rules, flair requirements, automated moderation, and removal norms shape what can be said and who may say it (Chandrasekharan et al., 2018). Reddit’s AutoModerator performs a large share of that work at scale (Jhaver et al., 2019), and analysis of removals across 1.2 million users found that moderators are more likely to remove content opposing their own political orientation (Huang et al., 2024). Moderation is not a contaminant to be controlled away: it can raise signal-to-noise and draw ideological boundaries at the same time. A comparison of two communities is therefore also a comparison of two governance regimes, and the regime must be documented alongside the text.'));
add(H2('Contested information environments'));
add(para('Communities that discuss Iran are documented targets of state influence. In August 2018 FireEye reported an Iranian operation running inauthentic news sites across platforms (FireEye, 2018); Reddit removed 143 associated accounts, and NBC News reported that volunteer moderators had warned the company for a year and that r/worldnews had been the operation’s most effective target (Collins, 2018). During the 2026 conflict, researchers documented an IRGC-affiliated network using Spanish-language personas claiming to be in Texas, California, Venezuela, and Chile (Murray & Linvill, 2026), and networks distributing AI-generated war footage (Cyabra, 2026). State-sponsored accounts move across platforms and communities (Zannettou et al., 2019), and communities themselves are porous: users mobilize across them (Kumar et al., 2018; Datta & Adar, 2019) and participate in sets of communities that together express social position (Waller & Anderson, 2021). The appropriate unit of analysis is often the network of communities, not any one of them.'));

// ================================================================ 3 =========
add(H1('The Threshing Floor'));
add(H2('Design principles'));
add(para('Thresh is a single-page application served as static files from Cloudflare Pages. It has no build step, no framework, no database, and no accounts; collections persist only in the user’s browser (‹localStorage›). Five principles govern it: **no code** (the user never touches a terminal); **local-first** (Reddit data never passes through a Thresh server); **provenance is non-negotiable** (no export leaves without its record); **privacy by default** (usernames are pseudonymized unless the user opts out, and the opt-out is recorded); and **truthfulness about limits** (the interface states what it cannot do, including that collection is impractical on phones). Pages carry both a metaphor and a plain label: The Floor (dashboard), Thresh (collection), Harvest (inspection), Winnow (analysis), and Glean (export).'));
add(H2('Human-in-the-loop collection'));
add(para('Version 2 of Thresh makes no requests to Reddit. Instead it hands the request to the researcher (Figure 1). **(1)** The researcher sets a query—subreddit(s), sort, time window, optional keyword, and a target of up to 500 posts—and Thresh constructs the exact URL, displayed in full. For the worked example’s query this is ‹' + TV.example_url.replace('https://www.', '') + '›. **(2)** The researcher opens the URL in an ordinary browser tab, which Reddit serves as it would to any reader, selects all, and copies. **(3)** The researcher pastes the text into Thresh, which parses it locally. Reddit returns at most 100 posts per page; for larger collections Thresh reads the ‹after› cursor from each paste and hands over the next URL. Comments are gathered per post, deliberately, from the Harvest page. Mistakes produce specific, plain-language guidance rather than stack traces: pasting a rendered web page, a truncated selection, a comment thread into the posts box, or the error object of a private subreddit each yields its own message (Supplement S2).'));
add(figure('fig1_workflow.png', 1, 'The Thresh v2 data path. The only request to Reddit is the researcher’s own click (blue); parsing, analysis, and export occur inside the browser (dashed boundary). The optional AI Worker is the only Thresh-operated server; it receives at most 50 post titles and bodies—never usernames—and only when AI features are used.'));
add(para('Three consequences follow. There is nothing to rate-limit, because Thresh makes no automated requests; the interface instead asks users to browse courteously. Collection is a desktop activity, stated as such in the interface. And the procedure is transparent in a way automated pipelines are not: the researcher sees every request leave and every byte arrive, and a reviewer can repeat any page of the collection by opening the recorded URL. Thresh uses no IP rotation, header spoofing, or other evasion; a person reading public pages at human pace is the entire mechanism.'));
add(H2('The provenance seal'));
add(para('Each export is a ZIP archive containing the data (CSV with a UTF-8 byte-order mark for spreadsheet compatibility, or JSON) and ‹provenance.txt›. Table 2 lists its fields with the worked example’s values; the record is written to be pasted into a methods section.'));
add(table(2, 'Fields of the provenance record, with values from the worked example’s export.',
  ['Section', 'Fields', 'Worked-example value'],
  [
    ['Tool', 'Name, version, collection method', `Thresh ${A.tool_version} (collected before v2); public JSON endpoints, no authentication`],
    ['Parameters', 'Subreddit(s), sort, time filter, max posts requested, keyword, comments', `r/${A.subreddits}; ${A.sort}; ${A.time_filter}; ${A.max_posts_requested}; “${A.keyword}”; yes`],
    ['Results', 'Posts and comments collected; collection time (UTC)', `${A.posts_claimed} posts; ${num(A.comments_claimed)} comments; ${A.collection_timestamp_utc.slice(0, 16).replace('T', ' ')} UTC`],
    ['Export', 'Format; authors anonymized; export time (UTC)', 'CSV; yes; 2026-03-20 20:54 UTC'],
    ['Source', 'Endpoint template; access method; intermediaries', 'reddit.com/r/{subreddit}/{sort}.json; public JSON; v1 relay (v2: none)'],
    ['Limitations', 'Page ceiling, point-in-time scores, exclusions, depth', '~100 posts per request; snapshot; comments to depth 2'],
    ['Ethics', 'Re-identification, IRB, platform terms', 'Standard reminders and link to Reddit’s terms'],
  ], [0.95, 2.3, 3.45]));
add(H2('Analysis, AI assistance, and privacy'));
add(para('Harvest provides sortable tables, search, and summary statistics; Winnow provides post volume over time and word frequencies computed in the browser. Optional AI features (themes, sentiment, summaries, extracted questions, and a draft research report exported as ‹.docx›) route a sample of at most 50 post titles and bodies, without usernames, through a Cloudflare Worker to Anthropic’s Claude; outputs are labelled as AI-generated. We regard these outputs as hypothesis-generating aids, not measurements, and the worked example below uses none of them. Thresh collects no analytics or telemetry.'));
add(H2('Verification'));
add(para(`A harness (‹analysis/verify_tool.js›) loads Thresh’s production modules into a Node.js sandbox, with no network access, and checks URL construction, parsing of synthetic fixtures (nested replies, “more” stubs, each error class), CSV quoting, and pseudonymization. All ${TV.summary.total} checks pass. Critically for this paper, the v2 paste parser and exporter emit exactly the column set, in the same order, as the v1-collected exemplar (15 post fields; 9 comment fields), so the exemplar is analytically interchangeable with a v2 harvest.`));

// ================================================================ 4 =========
add(H1('A study design for contested discourse'));
add(para('Thresh was put to work on a question with every difficulty described in Section 2: how different Reddit communities framed the 2026 war with Iran. A methodological memorandum prepared for that project set four commitments, which we adopt as general guidance. **First**, ask only what Reddit can answer—framing, change, comparison, propagation—never population attitudes. **Second**, treat influence operations as an object of study rather than a confound; detection of strategic communication may be the primary contribution. **Third**, prefer the network of communities to the single community as the unit of analysis. **Fourth**, audit each community’s governance—rules, posting restrictions, flair, moderator transparency—before collection, and preserve the audit as a research artifact.'));
add(para(`Table 3 condenses the resulting ${kSum}-community sampling frame. Tiers separate the core comparative set from r/worldnews, which is analyzed separately as a site of narrative amplification and a test case for coordination detection; from two diaspora anchors whose inclusion is conditional on the governance audit; and from a reserve set drawn on for specific questions. Characterizations are hypotheses for the audit, not established facts. Supplement S1 gives, for every community, the exact Thresh URLs for the first and subsequent pages, generated by executing Thresh’s own URL builder; a governance-audit template is provided with the data.`));
add(table(3, 'Pre-specified sampling frame for comparative research on Reddit discourse about the 2026 Iran war (condensed; full frame with Thresh URLs in Supplement S1).',
  ['Tier', 'Community', 'Register and analytic role', 'Governance hypothesis / principal caveat'],
  [
    { group: 'Core comparative set' },
    ['C1', 'r/MiddleEast', 'Regional discourse; broad regional framing', 'Moderation unverified; self-selected regional audience'],
    ['C2', 'r/geopolitics', 'Analytical register; high signal-to-noise', 'Quality rules likely; low volume'],
    ['C3', 'r/politics', 'U.S. left-leaning baseline (worked example)', 'Civility moderation; what appears is the moderated subset'],
    ['C4', 'r/Libertarian', 'War-powers and constitutional framing', 'Ideologically specific; rules unverified'],
    ['C5', 'r/CredibleDefense', 'Military and strategic analysis', 'Strict sourcing norms; heavily curated'],
    { group: 'Special case and conditional anchors' },
    ['S1', 'r/worldnews', 'Narrative amplification; coordination test case', 'Documented 2018 Iranian operation target; analyze separately'],
    ['A1–A2', 'r/iran, r/iranian', 'Diaspora and inside-Iran voices', 'Political posting may be reputation-gated; include only after audit'],
    { group: 'Reserve and excluded' },
    ['R1–R9', 'r/exmuslim, r/persianculture, r/tehran, r/arabs, r/Conservative, r/AskMiddleEast, r/war, r/IsraelPalestine, r/syriancivilwar', 'Deliberately partial perspectives, counterparts, and comparison cases', 'e.g., r/Conservative may gate comments to flaired users (not symmetric with r/politics); r/IsraelPalestine heavily brigaded'],
    ['X1', 'r/iranian_diaspora', 'Proposed', 'No evidence of an active community; dropped unless confirmed'],
  ], [0.55, 1.55, 2.0, 2.6]));
add(para('The memorandum’s watch-list of signals—user overlap, account age, posting-time rhythm, cross-language content, synchronized sentiment shifts—must be matched against what a Thresh export actually contains. Table 4 does so and reports the worked example’s result for each measurable signal. Account age is the notable gap: listings do not carry it, and obtaining it would require one additional request per account, a per-person lookup we judged inconsistent with the instrument’s privacy posture.'));
add(table(4, 'From watch-list to measurement: which coordination and framing signals a Thresh export supports, and what the worked example found.',
  ['Signal', 'In a Thresh export?', 'Operationalization', 'Worked example (r/politics)'],
  [
    ['User overlap', 'Yes (within and across exports)', 'Deterministic pseudonyms; threads or collections per account; Jaccard overlap', `${num(P.authors_in_ge2_threads)} of ${num(P.pseudonymous_commenters)} commenters (${pct(P.authors_in_ge2_threads_share)}) in ≥2 threads; max ${P.max_threads_by_one_author}`],
    ['Account age', 'No', 'Requires per-account lookups; out of scope by design', 'Not measured'],
    ['Posting-time rhythm', 'Yes', 'Hour-of-day distribution; Rayleigh test', `Peak ${hourLabel(T.comment_peak_hour_et)}, trough ${hourLabel(T.comment_trough_hour_et)} ET; ${pct(T.overnight_share_01_06_et)} overnight`],
    ['Cross-language content', 'Yes', 'Script detection (Arabic/Persian, Hebrew, Cyrillic, CJK); Spanish function-word test', `${L.arabic_script_comments} Arabic/Persian-script, ${L.spanish_dominant_comments} Spanish-dominant comments`],
    ['Synchronized bursts', 'Partial', 'Verbatim duplicate texts (≥40 characters) across accounts and threads', `${L.duplicate_text_groups} duplicate groups, ${L.duplicate_groups_multi_author} multi-account; organic quotation`],
    ['Sentiment time series', 'Yes', 'Daily mean VADER with bootstrap intervals', `Mean ${dec(FS.vader_mean)}; daily range ${dec(FS.daily_mean_min)} to ${dec(FS.daily_mean_max)}; no trend`],
    ['Governance footprint', 'Yes', 'Bot notices, removed/deleted content, moderator flair', `Bot notice first in ${pct(G.bot_notice_first_in_thread_share, 0)} of threads; ${pct(G.removed_or_deleted_share)} removed or deleted`],
  ], [1.15, 1.1, 2.1, 2.35]));

// ================================================================ 5 =========
add(H1('Worked example: r/politics and Iran, February–March 2026'));
add(H2('Data'));
add(para(`On 28 February 2026 the United States and Israel began strikes on Iran (House of Commons Library, 2026; Congressional Research Service, 2026). On 20 March 2026, three weeks into the war, a Thresh export was taken of r/politics with the keyword “${A.keyword}”, sort “${A.sort}”, and time window “${A.time_filter}”. The export contains ${A.posts_observed} posts (of ${A.max_posts_requested} requested; Reddit’s search endpoint returned one page) and ${num(A.comments_observed)} comments. Posts span ${A.post_window_start_utc.slice(0, 10)} to ${A.post_window_end_utc.slice(0, 10)}; every title contains the keyword and every post is a link to an external article. The export predates v2: it was collected with Thresh ${A.tool_version} through the since-retired relay, which captured the first 50 comments of each thread to depth 2. Because the verification harness establishes schema identity, the export is analyzed exactly as a v2 harvest would be. Files are distributed with SHA-256 checksums.`));
add(H2('Measures'));
add(para(`Bot notices were identified by the AutoModerator signature and, independently, by recomputing Thresh’s pseudonym for the username “AutoModerator”; both methods identify the same ${G.bot_comments} comments. Comments whose body was “[removed]” or “[deleted]”, and bot notices, were excluded from text measures, leaving ${num(FS.n_analyzable)} analyzable comments. Diurnal structure was assessed in U.S. Eastern time with a Rayleigh test. Participation concentration was summarized with the Gini coefficient over comments per pseudonymous account. Framing used a transparent dictionary of 11 frames (Supplement S3), matched case-insensitively at word boundaries; frames index topic, not stance, and a comment may carry several. Sentiment used VADER (Hutto & Gilbert, 2014), with daily means reported for days with at least 30 comments and 95% percentile-bootstrap intervals (${num(STATS.n_bootstrap)} resamples, fixed seed). Proportions carry Wilson intervals. No verbatim user comment is reproduced in this paper or its outputs.`));
add(H2('Results'));
add(para(`**The shape of the sample.** Provenance and data agreed exactly: ${A.posts_observed} posts and ${num(A.comments_observed)} comments claimed and observed, with no duplicate identifiers and no orphaned comments. The export nonetheless holds a small, specific slice of the conversation. Reddit reported ${num(A.reported_comments_total)} comments on these posts; the export contains ${pct(A.coverage_overall)} of them (median per thread ${pct(A.coverage_per_post_median)}, interquartile range ${pct(A.coverage_per_post_iqr[0])}–${pct(A.coverage_per_post_iqr[1])}), because capture stopped near 50 comments per thread regardless of thread size (Figure 3B). Comments are split between top-level replies (${num(A.comment_depths['0'])}) and first-level replies (${num(A.comment_depths['1'])}). Posts had been live for a median of ${Math.round(A.hours_to_collection_median / 24)} days at collection, so scores are late-stage snapshots. These are properties of the ranking and the collector, not of r/politics, and they bound every result that follows.`));
add(para(`**Governance footprint.** AutoModerator wrote the first comment in ${pct(G.bot_notice_first_in_thread_share, 0)} of threads (${G.bot_comments} comments, ${pct(G.bot_comment_share)} of the export), in each case restating the civility rules and the paywall-flair policy. Every post carried moderator flair classifying the linked article’s paywall status (No Paywall ${G.flair_components['No Paywall']}, Possible Paywall ${G.flair_components['Possible Paywall']}, Paywall ${G.flair_components['Paywall']}), and ${G.site_altered_headline_posts} were flagged “Site Altered Headline.” ${G.removed_bodies} comments were visibly removed and ${G.deleted_bodies} deleted, with ${G.deleted_authors} from since-deleted accounts; removals invisible in the listing cannot be counted. Agreement was near-unanimous: mean upvote ratio ${dec(E.upvote_ratio_mean, 3)}, with ${pct(E.upvote_ratio_share_ge_095, 0)} of posts at or above 0.95 and none below ${dec(E.upvote_ratio_min)}. Post score and comment volume were strongly correlated (Spearman ρ = ${dec(E.spearman_score_comments)}, ${pval(E.spearman_score_comments_p)}).`));
add(para(`**Temporal structure.** A single post preceded the war; the busiest day was ${T.peak_post_day.slice(8)} February, the day strikes began (${T.peak_post_day_posts} posts), and ${T.posts_first_72h_from_2026_02_28} posts (${pct(T.posts_first_72h_from_2026_02_28 / A.posts_observed, 0)}) date from its first 72 hours (Figure 2A). Commenting followed a pronounced North American day (Figure 2B): the peak hour was ${hourLabel(T.comment_peak_hour_et)} and the trough ${hourLabel(T.comment_trough_hour_et)} Eastern, only ${pct(T.overnight_share_01_06_et)} of comments fell between 01:00 and 06:59 against ${pct(T.overnight_share_if_uniform, 0)} expected under uniformity, and the distribution departed strongly from uniform (Rayleigh R̄ = ${dec(T.rayleigh_R)}, z = ${num(T.rayleigh_z)}, ${pval(T.rayleigh_p)}).`));
add(figure('fig2_temporal.png', 2, 'Temporal structure of the exemplar. (A) Posts per day; the dashed line marks the start of U.S.–Israeli strikes on 28 February 2026. (B) Share of analyzable comments by hour of day in U.S. Eastern time; the dashed line is the uniform expectation (4.2% per hour).'));
add(para(`**Source ecology.** The 100 posts linked to ${SRC.distinct_domains} outlets, but two dominated: ${SRC.top1_domain} (${pct(SRC.top1_share, 0)} of posts) and ${SRC.top2_domain} (${pct(SRC.top2_share, 0)}); the five most-linked outlets supplied ${pct(SRC.top5_share, 0)} of posts, and the effective number of outlets was ${dec(SRC.effective_number_of_outlets, 1)} (Herfindahl ${dec(SRC.hhi, 3)}; Figure 3A). Among the top-ranked posts, then, the war reached r/politics largely through a handful of progressive and opinion-forward outlets.`));
add(figure('fig3_sources_coverage.png', 3, 'Sources and capture. (A) Outlets linked by the 100 posts (top 10 of 39; two hostnames of The Independent are merged). (B) Comments in the export against comments Reddit reported for each thread, on log scales. Capture stopped near 50 per thread, so the shaded region—the unobserved conversation—grows with thread size.'));
add(para(`**Participation.** ${num(P.pseudonymous_commenters)} pseudonymous accounts wrote the ${num(P.comments_by_identified_humans)} attributable comments. Concentration was low (Gini ${dec(P.gini)}; the most active 10% of accounts wrote ${pct(P.top10pct_share, 0)} of comments), and ${pct(P.single_comment_author_share, 0)} of accounts appear exactly once (Figure 4A). Still, ${num(P.authors_in_ge2_threads)} accounts (${pct(P.authors_in_ge2_threads_share)}) commented in two or more threads, ${P.authors_in_ge5_threads} in five or more, and one in ${P.max_threads_by_one_author} (Figure 4B). ${P.distinct_post_submitters} accounts submitted the 100 posts; ${P.submitters_with_ge2_posts} submitted more than one (maximum ${P.max_posts_by_one_submitter}). Because only the top of each thread was captured, low concentration here describes who reaches the visible top of a thread, not overall activity.`));
add(figure('fig4_participation.png', 4, 'Participation structure. (A) Lorenz curve of comments per pseudonymous account; the dashed diagonal is perfect equality. (B) Number of distinct threads each account commented in (log scale). Bot notices, deleted accounts, and removed or deleted comments are excluded.'));
add(para(`**Framing and sentiment.** ${pct(FS.any_frame_share, 0)} of analyzable comments matched at least one frame (Figure 5A). Partisan and leadership references dominated (${pct(frame('Partisan & leadership').share)}), roughly three times the most common war-substantive frame, military operations (${pct(frame('Military operations').share)}), followed by Israel (${pct(frame('Israel').share)}), casualties and humanitarian consequences (${pct(frame('Casualties & humanitarian').share)}), and war powers and Congress (${pct(frame('War powers & Congress').share)}). Explicit discussion of propaganda, bots, or disinformation was rare (${pct(frame('Information integrity').share)}). Sentiment was negative overall (mean ${dec(FS.vader_mean)}, median ${dec(FS.vader_median)}; ${pct(FS.share_negative, 0)} of comments negative, ${pct(FS.share_positive, 0)} positive), most negative in casualty-framed comments (mean ${dec(frame('Casualties & humanitarian').mean_vader)}) and least negative in diplomacy-framed comments (${dec(frame('Diplomacy & ceasefire').mean_vader)}). Daily means ranged from ${dec(FS.daily_mean_min)} to ${dec(FS.daily_mean_max)} with no monotonic trend (Spearman ρ = ${dec(FS.daily_trend_spearman)}, ${pval(FS.daily_trend_p)}; Figure 5B), and sentiment was essentially unrelated to comment score (ρ = ${dec(FS.spearman_comment_score_vs_vader, 3)}).`));
add(figure('fig5_frames_sentiment.png', 5, 'Framing and sentiment. (A) Share of analyzable comments matching each dictionary frame, with Wilson 95% intervals; frames are not mutually exclusive. (B) Daily mean VADER compound score with 95% bootstrap intervals, for days with at least 30 comments; the isolated point is the single pre-war thread.'));
add(para(`**Coordination and language signals.** No comment contained Arabic or Persian script, Hebrew, or Cyrillic; ${L.cjk_script_comments === 1 ? 'one' : L.cjk_script_comments} contained CJK characters; none was Spanish-dominant. Among ${num(L.long_texts_considered)} comments of at least 40 characters, ${L.duplicate_text_groups} texts appeared more than once (at most ${L.max_copies_of_one_text} copies). Two recurred across different accounts; on inspection both reproduce a public figure’s widely circulated 2011–2012 statements predicting that a president would start a war with Iran—quotation as rebuttal, a familiar organic pattern, rather than coordination. In the visible top of the r/politics conversation, the watch-list signals were quiet.`));

// ================================================================ 6 =========
add(H1('Discussion'));
add(H2('What the exemplar shows about the instrument'));
add(para('The most important results above are not about Iran. They are the facts a careless reading would miss and a provenance-first instrument makes difficult to miss: that the export held about one comment in eighteen; that its selection followed Reddit’s ranking of posts and of comments within threads; that a moderator bot opened every thread; that near-unanimous upvote ratios describe a consensus space; and that two outlets set much of the agenda. Each is recoverable from the provenance record and the export alone, by anyone, without access to the collector’s machine. That is the practical meaning of provenance: the shape of the sample travels with the sample.'));
add(H2('A bounded substantive reading'));
add(para('Within those bounds, the top of the r/politics conversation about the war’s first three weeks was principally a conversation about domestic political leadership: partisan and leadership references outnumbered every war-substantive frame, discussion of war powers and Congress was present but secondary, and the mood was steadily negative. This is what the memorandum anticipated for a left-leaning, civility-moderated U.S. baseline—and it is precisely why a single community cannot carry comparative claims. Whether this domestic register is distinctive to r/politics, or shared by r/Libertarian’s constitutional framing and r/CredibleDefense’s operational analysis, is a question for the full frame, collected under the same parameters and audited for governance first.'));
add(H2('Limitations'));
add(para(`**Ranking and truncation.** “Top” listings and comment ordering select for resonance; the exemplar is the most-upvoted slice, not a random sample. **Point in time.** Scores, comment counts, and removals change after collection. **Collector version.** The exemplar was collected with v1, which truncated threads at about 50 comments; v2 captures whatever the pasted page contains. **One community.** The worked example demonstrates the pipeline, not the comparative design. **Instruments.** Dictionary frames index topic, not stance; VADER is not tuned to political sarcasm. **No account metadata.** Account age and history are unavailable by design. **Scale.** Manual collection is bounded by human labor (100 posts per paste; at most 500 per collection) and is impractical on mobile devices. **Pseudonyms.** The harness confirmed that Thresh’s default pseudonyms are a 32-bit, unsalted string hash: deterministic, which usefully links the same account across exports, but reversible by anyone who hashes candidate usernames—recomputing the hash of “AutoModerator” recovers its pseudonym exactly (‹${G.automoderator_pseudonym}›)—and subject to collisions in large datasets (by the birthday bound, about ${pct(TV.pseudonym.collision_probability['100000'], 0)} probability of at least one collision among 100,000 distinct usernames). Exports should therefore be treated as pseudonymized, not anonymized. **Provenance wording.** The audit also found that the provenance template stated that deleted and removed items are excluded, whereas Reddit’s “[deleted]” and “[removed]” placeholders are retained (Supplement S4); the template is corrected in the release accompanying this paper.`));
add(H2('Ethics'));
add(para('Public availability does not settle the ethics of use (Zimmer, 2010), and users often do not expect research use of their posts (Fiesler & Proferes, 2018). Verbatim quotation can re-identify authors through search (Ayers et al., 2018). This study used only public posts, involved no interaction with users, analyzed pseudonymized exports, reports only aggregates and news headlines, and reproduces no user comment. The pseudonym weakness above strengthens the case for treating Thresh exports as sensitive research data and for institutional review where required.'));
add(H2('Roadmap'));
add(para('Four changes follow directly from this paper: **(1)** salted, per-project pseudonyms with an explicit option to preserve cross-collection linkage; **(2)** provenance that records every pasted URL and a SHA-256 hash of each raw paste, so a collection can be verified byte for byte; **(3)** an in-tool governance-audit capture that archives sidebar rules with the export; and **(4)** collection of the full sampling frame in Table 3 under the parameters of Supplement S1, with the cross-collection overlap analysis the pipeline already supports.'));

// ================================================================ 7 =========
add(H1('Conclusion'));
add(para('Reddit’s closure to automated access removed the easy path to its data. Thresh takes the remaining honest one: a person, reading public pages as any person may, carrying what they gather to a place where it can be separated, weighed, and sealed. That path is slower and smaller than a pipeline. In exchange it is legitimate, transparent to reviewers, and open to anyone with a browser and a question. For the bounded, question-driven studies that make up much of public-interest research, that is the better trade—so long as the researcher treats ranking, truncation, and governance as part of what was harvested.'));

// ============================================================ back matter ==
const backH = t => new Paragraph({ spacing: { before: 160, after: 40 }, keepNext: true,
  children: [new TextRun({ text: t, font: FONT_SB, size: 17, color: EMBER_DK })] });
const backP = t => para(t, { run: { size: 16 }, after: 60, line: 240 });
add(new Paragraph({ spacing: { before: 200, after: 0 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } }, children: [] }));
add(backH('Data and code availability'));
add(backP('Everything needed to reproduce this paper is in the ‹preprint/› directory of the Thresh repository: the exemplar export with SHA-256 checksums; the sampling frame, governance-audit template, and frame dictionary; the verification harness; the analysis pipeline, which regenerates every figure, table, and number (‹results/stats.json›) from the data in seconds; and the script that typesets this manuscript from those results. One command (‹reproduce.sh›) runs the full chain. Thresh is MIT-licensed (Thomas, 2026); this manuscript is released under CC BY 4.0.'));
add(backH('Ethics statement'));
add(backP('Analysis of publicly available, pseudonymized Reddit content without interaction with users. No verbatim user comments are reproduced. Researchers extending this work should consult their institution’s review board.'));
add(backH('Author contributions, competing interests, and funding'));
add(backP('J.E.T. conceived and built The Threshing Floor, designed the study, conducted the analysis, and wrote the manuscript. The author is the developer of the software described and receives no income from it. The work received no dedicated funding.'));
add(backH('Use of AI tools'));
add(backP('Claude (Anthropic) assisted with drafting the manuscript and writing the analysis and verification code. The author directed the work, reviewed all code and text, and takes responsibility for the content. No AI-generated analysis of the data is reported.'));
add(backH('Acknowledgements'));
add(backP('The author thanks the IranWar.ai project collaborators whose methodological memorandum shaped the study design in Section 4.'));

// -------------------------------------------------------------- references --
add(new Paragraph({ spacing: { before: 240, after: 100 }, keepNext: true, heading: HeadingLevel.HEADING_1, children: [new TextRun('References')] }));
const REFS = [
  'Ayers, J. W., Caputi, T. L., Nebeker, C., & Dredze, M. (2018). Don’t quote me: Reverse identification of research participants in social media studies. *npj Digital Medicine, 1*, 30. https://doi.org/10.1038/s41746-018-0036-2',
  'Baumgartner, J., Zannettou, S., Keegan, B., Squire, M., & Blackburn, J. (2020). The Pushshift Reddit dataset. *Proceedings of the International AAAI Conference on Web and Social Media, 14*, 830–839.',
  'Bruns, A. (2019). After the ‘APIcalypse’: Social media platforms and their fight against critical scholarly research. *Information, Communication & Society, 22*(11), 1544–1566. https://doi.org/10.1080/1369118X.2019.1637447',
  'Chandrasekharan, E., Samory, M., Jhaver, S., Charvat, H., Bruckman, A., Lampe, C., Eisenstein, J., & Gilbert, E. (2018). The Internet’s hidden rules: An empirical study of Reddit norm violations at micro, meso, and macro scales. *Proceedings of the ACM on Human-Computer Interaction, 2*(CSCW), Article 32.',
  'Collins, B. (2018, August 24). Volunteers found Iran’s propaganda effort on Reddit — but their warnings were ignored. *NBC News*. https://www.nbcnews.com/tech/tech-news/volunteers-found-iran-s-propaganda-effort-reddit-their-warnings-were-n903486',
  'Congressional Research Service. (2026, March 26). *U.S. conflict with Iran* (CRS Report R48887). https://www.congress.gov/crs_external_products/R/PDF/R48887/R48887.1.pdf',
  'Cyabra. (2026, March 9). *The AI propaganda war: Iran’s digital battlefield*. https://www.inss.org.il/he/wp-content/uploads/sites/2/2026/03/Cyabra-Research-Iran-AI-Driven-Information-Warfare-Epic-Fury.pdf',
  'Datta, S., & Adar, E. (2019). Extracting inter-community conflicts in Reddit. *Proceedings of the International AAAI Conference on Web and Social Media, 13*, 146–157.',
  'Fiesler, C., & Proferes, N. (2018). “Participant” perceptions of Twitter research ethics. *Social Media + Society, 4*(1). https://doi.org/10.1177/2056305118763366',
  'FireEye. (2018, August 21). *Suspected Iranian influence operation leverages network of inauthentic news sites & social media targeting audiences in U.S., UK, Latin America, Middle East*. https://cloud.google.com/blog/topics/threat-intelligence/suspected-iranian-influence-operation',
  'Freelon, D. (2018). Computational research in the post-API age. *Political Communication, 35*(4), 665–668. https://doi.org/10.1080/10584609.2018.1477506',
  'Gottfried, J., & Park, E. (2025, November 20). *Americans’ social media use 2025*. Pew Research Center. https://www.pewresearch.org/internet/2025/11/20/americans-social-media-use-2025/',
  'House of Commons Library. (2026). *Israel/US–Iran conflict 2026: Background and UK response* (Research Briefing CBP-10521). https://commonslibrary.parliament.uk/research-briefings/cbp-10521/',
  'Huang, J. T., Choi, J., & Wan, Y. (2024). *Politically biased moderation drives echo chamber formation: An analysis of user-driven content removals on Reddit* [Working paper]. SSRN. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4990476',
  'Hutto, C. J., & Gilbert, E. (2014). VADER: A parsimonious rule-based model for sentiment analysis of social media text. *Proceedings of the International AAAI Conference on Web and Social Media, 8*(1), 216–225.',
  'Isaac, M. (2023, April 18). Reddit wants to get paid for helping to teach big A.I. systems. *The New York Times*.',
  'Jhaver, S., Birman, I., Gilbert, E., & Bruckman, A. (2019). Human-machine collaboration for content regulation: The case of Reddit Automoderator. *ACM Transactions on Computer-Human Interaction, 26*(5), Article 31.',
  'Kumar, S., Hamilton, W. L., Leskovec, J., & Jurafsky, D. (2018). Community interaction and conflict on the web. *Proceedings of the 2018 World Wide Web Conference*, 933–943.',
  'Medvedev, A. N., Lambiotte, R., & Delvenne, J.-C. (2019). The anatomy of Reddit: An overview of academic research. In *Dynamics on and of Complex Networks III* (pp. 183–204). Springer.',
  'Murray, E., & Linvill, D. (2026, March 11). *From Texas to Tehran: A multilingual, IRGC-affiliated influence operation on X, Instagram, and Bluesky* (Media Forensics Hub Report No. 10). Clemson University. https://open.clemson.edu/mfh_reports/10/',
  'Perez, S. (2024, May 9). Reddit locks down its public data in new content policy, says use now requires a contract. *TechCrunch*. https://techcrunch.com/2024/05/09/reddit-locks-down-its-public-data-in-new-content-policy-says-use-now-requires-a-contract',
  'Proferes, N., Jones, N., Gilbert, S., Fiesler, C., & Zimmer, M. (2021). Studying Reddit: A systematic overview of disciplines, approaches, methods, and ethics. *Social Media + Society, 7*(2). https://doi.org/10.1177/20563051211019004',
  'Reddit. (2026). *Reddit for Researchers program*. Reddit Help. Retrieved September 29, 2026, from https://support.reddithelp.com/hc/en-us/articles/49381918834964-Reddit-for-Researchers-Program',
  'Thomas, J. E. (2026). *The Threshing Floor* (Version 2.0.0) [Computer software]. https://github.com/jethomasphd/The_Threshing_Floor',
  'Waller, I., & Anderson, A. (2021). Quantifying social organization and political polarization in online platforms. *Nature, 600*, 264–268. https://doi.org/10.1038/s41586-021-04167-x',
  'Zannettou, S., Caulfield, T., De Cristofaro, E., Sirivianos, M., Stringhini, G., & Blackburn, J. (2019). Disinformation warfare: Understanding state-sponsored trolls on Twitter and their influence on the Web. *Companion Proceedings of the 2019 World Wide Web Conference*, 218–226.',
  'Zimmer, M. (2010). “But the data is already public”: On the ethics of research in Facebook. *Ethics and Information Technology, 12*(4), 313–325.',
];
REFS.forEach(r => add(new Paragraph({ spacing: { after: 50, line: 228 }, indent: { left: 300, hanging: 300 }, alignment: AlignmentType.LEFT,
  children: runs(r, { size: 15 }) })));

// ---------------------------------------------------- supplementary index ---
add(new Paragraph({ spacing: { before: 200, after: 60 }, keepNext: true, children: [new TextRun({ text: 'Supplementary materials', font: FONT_SB, size: 17, color: EMBER_DK })] }));
[
  '**S1** Sampling frame with Thresh-generated URLs for every community (‹data/protocol/sampling_frame.csv›) and the collection protocol.',
  '**S2** Tool verification report: all harness checks, the error messages for each malformed-paste class, and pseudonym properties (‹results/tool_verification.json›).',
  '**S3** Frame dictionary (‹data/protocol/frame_lexicon.json›), per-frame statistics, and top terms.',
  '**S4** Complete statistics (‹results/stats.json›) and all figure source tables (‹results/tables/›).',
].forEach(t => add(para(t, { run: { size: 15 }, after: 30, line: 228, align: AlignmentType.LEFT })));
add(new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: 'Supplementary document: Thomas_2026_The_Threshing_Floor_supplement.docx', size: 15, color: MUTED, italics: true })] }));

// ================================================================ build ======
function makeDoc(children, { title, description, runningHead, firstFooter }) {
  return new Document({
    creator: 'Jacob E. Thomas', title, description,
    subject: 'Research software; Reddit; data provenance',
    keywords: 'Reddit, provenance, human-in-the-loop, computational social science',
    styles: {
      default: { document: { run: { font: FONT, size: BODY, color: INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: DISPLAY, size: 32, color: INK },
          paragraph: { spacing: { before: 280, after: 100, line: 240 }, outlineLevel: 0, keepNext: true } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT_SB, size: 19, color: INK },
          paragraph: { spacing: { before: 160, after: 60, line: 240 }, outlineLevel: 1, keepNext: true } },
      ],
    },
    sections: [{
      properties: {
        titlePage: true,
        page: { size: { width: PAGE_W, height: 15840 }, margin: { top: 1224, bottom: 1152, left: MARGIN, right: MARGIN, header: 576, footer: 576 } },
      },
      headers: {
        first: new Header({ children: [new Paragraph({ children: [] })] }),
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.LEFT,
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E6E1D3', space: 4 } },
          children: [new TextRun({ text: runningHead, size: 14, color: MUTED }),
            new TextRun({ text: '\tPreprint v1.0 · September 2026', size: 14, color: MUTED })] })] }),
      },
      footers: {
        first: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: firstFooter, size: 13, color: MUTED })] })] }),
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ children: [PageNumber.CURRENT], size: 15, color: EMBER_DK })] })] }),
      },
      children,
    }],
  });
}

// ========================================================= SUPPLEMENT =======
const csvParse = text => {           // RFC-4180 reader (quoted fields, embedded commas)
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(h.map((k, j) => [k, r[j]])));
};
const readTable = name => csvParse(fs.readFileSync(path.join(PRE, 'results/tables', `${STATS.primary}__${name}.csv`), 'utf8'));
const monoCell = s => `‹${s}›`;

const sup = [];
const sadd = (...xs) => xs.flat().forEach(x => sup.push(x));
const sH1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new TextRun(t)] });
const sH2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun(t)] });

sadd(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'SUPPLEMENTARY MATERIALS  ·  v1.0  ·  29 SEPTEMBER 2026', font: FONT_SB, size: 14, color: EMBER, characterSpacing: 30 })] }));
sadd(new Paragraph({ spacing: { before: 100, after: 80, line: 300 }, children: [new TextRun({ text: 'Carrying the Harvest by Hand — Supplement', font: DISPLAY, size: 44, color: INK })] }));
sadd(para('Supplementary materials S1–S4 for Thomas (2026), *Carrying the Harvest by Hand: The Threshing Floor, a provenance-first, human-in-the-loop instrument for studying public Reddit discourse*. Every value below is generated from the files in the ‹preprint/› directory by ‹reproduce.sh›.', { after: 160 }));

// ---- S1
sadd(sH1('S1  Sampling frame and collection protocol'));
sadd(sH2('Protocol'));
[
  '**Before collecting,** complete the governance audit for each community (‹data/protocol/governance_audit_template.csv›): archive the sidebar rules (e.g., via a web archive) and record the archive URL and a SHA-256 hash of the rules text, posting restrictions, flair or approval gating of comments, account-age or karma thresholds, visible AutoModerator activity, removal-reason disclosure, public moderation logs, moderator count, flair taxonomy, and language norms.',
  '**Fix the parameters** for every community in a wave: keyword “Iran”, sort “top”, time window “month”, 100 posts per page. Record the wave’s start time (UTC).',
  '**Gather page 1** by opening the URL below in a desktop browser, selecting all (Ctrl/Cmd+A), copying, and pasting into Thresh. Thresh reports the ‹after› cursor and gives the page-2 URL (template below). Pause between pages.',
  '**Gather comments** for each post in the Harvest detail panel; for comparability, gather every thread, not a hand-picked subset, and note any threads that could not be loaded.',
  '**Export** each community as its own collection (CSV, pseudonymized) and place the unzipped folder in ‹preprint/data/collections/›. Re-running ‹reproduce.sh› adds the community to every table and computes cross-collection pseudonym overlap automatically.',
].forEach((t, i) => sadd(para(`${i + 1}.  ${t}`, { indent: { left: 280, hanging: 280 }, after: 70, align: AlignmentType.LEFT })));
const frameRows = csvParse(fs.readFileSync(path.join(PRE, 'data/protocol/sampling_frame.csv'), 'utf8'));
sadd(table('S1', 'Complete sampling frame. Page-1 URLs were generated by executing Thresh’s own URL builder (‹public/js/reddit.js›); for later pages append ‹&after=<cursor>› as Thresh instructs. Prefix every URL with ‹https://www.›.',
  ['Code', 'Community', 'Tier / role', 'Principal caveat', 'Page-1 URL'],
  frameRows.map(r => [r.code, `r/${r.subreddit}`, `${r.tier}. ${r.analytic_role}`, r.principal_caveat,
    r.thresh_url_page1 ? monoCell(r.thresh_url_page1.replace('https://www.', '')) : '—']),
  [0.45, 1.05, 1.6, 1.55, 2.05], { size: 13 }));

// ---- S2
sadd(sH1('S2  Tool verification report'));
sadd(para(`The harness ‹analysis/verify_tool.js› executes Thresh’s production modules in a Node.js sandbox with no network access. Run ${TV.generated_utc.slice(0, 10)}: ${TV.summary.total - TV.summary.failed} of ${TV.summary.total} checks passed.`));
const checkDesc = {
  'url.politics_keyword_search': 'Keyword search URL for the worked example is exactly as recorded',
  'url.multireddit_normalisation': '“r/geopolitics, CredibleDefense” normalizes to Reddit’s multireddit “+” syntax',
  'url.comments': 'Per-post comments URL (limit 500, raw_json)',
  'parse.listing_ok': 'Synthetic listing parses to 2 posts with the correct “after” cursor',
  'parse.comments_depth_and_more_stubs': 'Nested replies flatten with depths 0, 0, 1, 2; “more” stubs skipped',
  'schema.posts_v2_equals_v1_exemplar': 'v2 post export columns = v1 exemplar columns (same order)',
  'schema.comments_v2_equals_v1_exemplar': 'v2 comment export columns = v1 exemplar columns (same order)',
  'csv.bom_and_quoting': 'CSV has UTF-8 BOM; commas, quotes, newlines escaped per RFC 4180',
  'parse.friendly_errors': 'Each malformed-paste class returns a specific plain-language message',
  'anon.deterministic': 'Pseudonymization is deterministic',
  'anon.deleted_passthrough': '“[deleted]” is preserved, not hashed',
  'anon.reversible_by_dictionary': 'Hashing a known username recovers its pseudonym in the exemplar',
};
sadd(table('S2a', 'Harness checks.', ['Check', 'What it establishes', 'Result'],
  Object.entries(TV.checks).map(([k, v]) => [monoCell(k), checkDesc[k] || '', v.pass ? 'PASS' : 'FAIL']), [2.2, 3.7, 0.8], { size: 14 }));
sadd(table('S2b', 'Messages Thresh shows for each malformed paste (verbatim from ‹reddit.js›).', ['Paste', 'Message shown to the researcher'],
  Object.entries(TV.friendly_errors).map(([k, v]) => [k.replace(/_/g, ' '), v]), [1.5, 5.2], { size: 14 }));
sadd(table('S2c', 'Pseudonym properties. Scheme: ' + TV.pseudonym.scheme + '. Collision probability is the birthday bound for n distinct usernames in a 2³¹ output space.',
  ['n distinct usernames', '1,000', '10,000', '100,000', '1,000,000'],
  [['P(≥1 collision)', ...['1000', '10000', '100000', '1000000'].map(k => String(TV.pseudonym.collision_probability[k]))]],
  [2.0, 1.15, 1.15, 1.15, 1.25], { size: 14,
    note: `Reversibility: hashing “AutoModerator” gives ‹${TV.pseudonym.automoderator_pseudonym}›, which appears ${TV.pseudonym.automoderator_occurrences_in_exemplar} times in the exemplar. Any username can be tested the same way; treat exports as pseudonymized, not anonymized.` }));

// ---- S3
sadd(sH1('S3  Frame dictionary and lexical statistics'));
const lex = JSON.parse(fs.readFileSync(path.join(PRE, 'data/protocol/frame_lexicon.json'), 'utf8'));
const ftab = readTable('frames');
const fByName = Object.fromEntries(ftab.map(r => [r.frame, r]));
sadd(table('S3a', 'Frames, their regular-expression stems (matched case-insensitively at word boundaries), and results over analyzable comments (n = ' + num(FS.n_analyzable) + ').',
  ['Frame', 'Stems', 'Comments', 'Share (95% CI)', 'Mean VADER'],
  Object.keys(lex).filter(k => !k.startsWith('_')).map(k => {
    const r = fByName[k];
    return [k, monoCell(lex[k].join(' | ').replace(/\\\\/g, '\\')), num(r.comments),
      `${pct(+r.share)} (${pct(+r.ci_low)}–${pct(+r.ci_high)})`, dec(+r.mean_vader)];
  }), [1.35, 2.75, 0.75, 1.15, 0.7], { size: 13 }));
const terms = readTable('top_terms');
sadd(table('S3b', 'Most frequent terms (stop-words removed) in post titles and in analyzable comments.',
  ['Rank', 'Title term', 'n', 'Comment term', 'n'],
  terms.slice(0, 20).map(r => [r.rank, r.title_term, r.title_count, r.comment_term, num(+r.comment_count)]), [0.6, 1.9, 0.7, 1.9, 0.8], { size: 14 }));

// ---- S4
sadd(sH1('S4  Collection audit, headlines, and reproducibility record'));
sadd(table('S4a', 'Provenance claims checked against the exported bytes.', ['Item', 'Provenance says', 'Data show'],
  [
    ['Posts', String(A.posts_claimed), `${A.posts_observed} (${A.posts_match ? 'match' : 'MISMATCH'})`],
    ['Comments', num(A.comments_claimed), `${num(A.comments_observed)} (${A.comments_match ? 'match' : 'MISMATCH'})`],
    ['Keyword', `“${A.keyword}”`, `in ${pct(A.keyword_in_title_share, 0)} of titles`],
    ['Duplicate / orphan IDs', '—', `${A.duplicate_post_ids} post, ${A.duplicate_comment_ids} comment duplicates; ${A.orphan_comments} orphans`],
    ['Comment depth', 'limited to 2 levels', Object.entries(A.comment_depths).map(([d, n]) => `depth ${d}: ${num(n)}`).join('; ')],
    ['Deleted/removed content', 'excluded', `${G.removed_bodies} removed and ${G.deleted_bodies} deleted bodies, ${G.deleted_authors} deleted authors present — the v1 note overstates exclusion`],
    ['Time window', `${A.time_filter} before ${A.collection_timestamp_utc.slice(0, 10)}`, `${A.post_window_start_utc.slice(0, 10)} to ${A.post_window_end_utc.slice(0, 10)} (oldest post ${A.oldest_post_age_days_at_collection} days old)`],
    ['Thread coverage', '—', `${pct(A.coverage_overall)} of ${num(A.reported_comments_total)} reported comments; ${A.comments_per_post.min}–${A.comments_per_post.max} per thread`],
  ], [1.6, 1.8, 3.3], { size: 14 }));
const heads = readTable('top10_headlines');
sadd(table('S4b', 'The ten highest-scoring posts. Titles are the linked outlets’ headlines as posted; they are reproduced as published news titles, not user speech.',
  ['Date (UTC)', 'Score', 'Ratio', 'Comments', 'Outlet', 'Headline'],
  heads.map(r => [r.created_date.slice(0, 10), num(+r.score), r.upvote_ratio, num(+r.num_comments), r.domain, r.title]),
  [0.85, 0.6, 0.5, 0.7, 1.2, 2.85], { size: 13 }));
sadd(table('S4c', 'Reproducibility record.', ['Item', 'Value'],
  [
    ...Object.entries(C.checksums_sha256).map(([f, h]) => [`SHA-256 ${f}`, monoCell(h)]),
    ['Software', Object.entries(STATS.software).map(([k, v]) => `${k} ${v}`).join(' · ')],
    ['Random seed / bootstrap', `${STATS.seed} / ${num(STATS.n_bootstrap)} resamples`],
    ['Statistics generated (UTC)', STATS.generated_utc],
  ], [1.7, 5.0], { size: 13 }));

// ================================================================ write =====
const writeDoc = (doc, out, label) => Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log(`[thresh] ${label} → ${path.relative(PRE, out)} (${(buf.length / 1024).toFixed(0)} KB)`);
});
const OUT_SUP = path.join(PRE, 'Thomas_2026_The_Threshing_Floor_supplement.docx');
Promise.all([
  writeDoc(makeDoc(kids, { title: 'Carrying the Harvest by Hand: The Threshing Floor',
    description: 'Preprint describing The Threshing Floor v2 with a worked example from r/politics (2026).',
    runningHead: 'Thomas · Carrying the Harvest by Hand',
    firstFooter: 'Preprint — not peer reviewed. © 2026 the author. CC BY 4.0.' }), OUT, 'manuscript'),
  writeDoc(makeDoc(sup, { title: 'Carrying the Harvest by Hand — Supplementary Materials',
    description: 'Supplementary materials S1–S4.', runningHead: 'Thomas · Supplementary Materials',
    firstFooter: 'Supplement to a preprint — not peer reviewed. © 2026 the author. CC BY 4.0.' }), OUT_SUP, 'supplement'),
]);
