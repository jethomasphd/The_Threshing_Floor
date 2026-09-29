#!/usr/bin/env node
/**
 * verify_tool.js — Executes The Threshing Floor's own browser modules
 * (public/js/reddit.js and public/js/exporter.js) inside a Node sandbox to
 * establish four facts the manuscript relies on:
 *
 *   1. URL construction: the exact Reddit .json URLs Thresh v2 hands a
 *      researcher for every subreddit in the sampling frame (Table 3 / S1).
 *   2. Schema equivalence: the v2 paste parser + exporter emit the same CSV
 *      columns, in the same order, as the v1 exemplar dataset analysed in the
 *      paper — so the v1-collected exemplar is analytically interchangeable
 *      with a v2 harvest.
 *   3. Parser behaviour on a synthetic fixture (depth, "more" stubs, errors).
 *   4. Pseudonymisation properties: determinism (enables cross-collection
 *      linkage) and reversibility by dictionary (a disclosed privacy limit).
 *
 * No network access. No dependencies beyond Node >= 18.
 * Usage:  node preprint/analysis/verify_tool.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
const PREPRINT = path.resolve(HERE, '..');
const REPO = path.resolve(PREPRINT, '..');
const out = { generated_utc: new Date().toISOString(), checks: {} };

// ---------------------------------------------------------------- sandbox ---
function loadModule(file, globalName) {
  const src = fs.readFileSync(path.join(REPO, 'public/js', file), 'utf8');
  const sandbox = { window: {}, URLSearchParams, console, Date, Math, JSON, String, Array, Object };
  vm.createContext(sandbox);
  vm.runInContext(`${src}\n;this.__mod = ${globalName};`, sandbox, { filename: file });
  return sandbox.__mod;
}
const Reddit = loadModule('reddit.js', 'RedditClient');
const Exporter = loadModule('exporter.js', 'Exporter');

let failures = 0;
function check(name, ok, detail) {
  out.checks[name] = { pass: !!ok, detail };
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  if (!ok) failures++;
}

// -------------------------------------------------- 1. URL construction -----
const KEYWORD = 'Iran', SORT = 'top', TIME = 'month';
const srcCsv = fs.readFileSync(path.join(PREPRINT, 'data/protocol/sampling_frame_source.csv'), 'utf8').trim().split(/\r?\n/);
const header = srcCsv[0].split(',');
const rows = srcCsv.slice(1).map(line => {
  const cells = line.split(','); // source file is authored without embedded commas
  return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
});
const csvEsc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const outHeader = [...header, 'thresh_url_page1', 'thresh_url_page2_template'];
const outLines = [outHeader.join(',')];
for (const r of rows) {
  const excluded = r.tier === 'Excluded';
  const cfg = { subreddit: r.subreddit, sort: SORT, timeFilter: TIME, limit: 100, keyword: KEYWORD };
  const p1 = excluded ? '' : Reddit.buildListingUrl(cfg);
  const p2 = excluded ? '' : Reddit.buildListingUrl(cfg, { after: 'AFTER_CURSOR_FROM_PAGE_1' });
  outLines.push([...header.map(h => r[h]), p1, p2].map(csvEsc).join(','));
}
fs.writeFileSync(path.join(PREPRINT, 'data/protocol/sampling_frame.csv'), outLines.join('\n') + '\n');
const exampleUrl = Reddit.buildListingUrl({ subreddit: 'politics', sort: SORT, timeFilter: TIME, limit: 100, keyword: KEYWORD });
check('url.politics_keyword_search', exampleUrl === 'https://www.reddit.com/r/politics/search.json?limit=100&raw_json=1&q=Iran&restrict_sr=on&sort=top&t=month', exampleUrl);
check('url.multireddit_normalisation', Reddit.normalizeSub('r/geopolitics, CredibleDefense') === 'geopolitics+CredibleDefense', Reddit.normalizeSub('r/geopolitics, CredibleDefense'));
check('url.comments', Reddit.buildCommentsUrl('politics', 'fx0001') === 'https://www.reddit.com/r/politics/comments/fx0001.json?limit=500&raw_json=1');
out.example_url = exampleUrl;
out.sampling_frame_rows = rows.length;

// ------------------------------------------- 2–3. parser + exporter schema --
const listing = Reddit.parseListingText(fs.readFileSync(path.join(HERE, 'fixtures/listing_fixture.json'), 'utf8'));
check('parse.listing_ok', listing.ok && listing.posts.length === 2 && listing.after === 't3_fx0002', { posts: listing.posts && listing.posts.length, after: listing.after });
const comm = Reddit.parseCommentsText(fs.readFileSync(path.join(HERE, 'fixtures/comments_fixture.json'), 'utf8'));
const depths = comm.comments.map(c => c.depth);
check('parse.comments_depth_and_more_stubs', comm.ok && comm.comments.length === 4 && JSON.stringify(depths) === '[0,0,1,2]', { n: comm.comments.length, depths });
comm.comments.forEach(c => { c.post_id = 'fx0001'; });

const postRow = Exporter._flattenPost(listing.posts[0], true);
const commRow = Exporter._flattenComment(comm.comments[0], true);
const exemplarDir = path.join(PREPRINT, 'data/collections/r-politics_iran_2026-03-20');
const firstLine = f => fs.readFileSync(path.join(exemplarDir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
const v1Post = firstLine('posts.csv'), v1Comm = firstLine('comments.csv');
const v2Post = Object.keys(postRow).join(','), v2Comm = Object.keys(commRow).join(',');
check('schema.posts_v2_equals_v1_exemplar', v1Post === v2Post, v2Post);
check('schema.comments_v2_equals_v1_exemplar', v1Comm === v2Comm, v2Comm);

const csv = Exporter._toCSV([Exporter._flattenPost(listing.posts[1], true)]);
check('csv.bom_and_quoting', csv.startsWith('﻿') && csv.includes('"Body text, with a comma and a ""quote"".\nSecond line."'));

const errs = {
  html: Reddit.parseListingText('<!doctype html><html>'),
  truncated: Reddit.parseListingText('{"kind":"Listing","data":{"children":['),
  comments_in_posts_box: Reddit.parseListingText('[{},{}]'),
  private_sub: Reddit.parseListingText('{"reason":"private","message":"Forbidden","error":403}'),
};
check('parse.friendly_errors', Object.values(errs).every(e => e.ok === false && e.error.length > 20),
  Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.error])));
out.friendly_errors = Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.error]));

// ------------------------------------------------ 4. pseudonymisation -------
const anon = u => Exporter._anonymize(u);
check('anon.deterministic', anon('fixture_author_a') === anon('fixture_author_a'));
check('anon.deleted_passthrough', anon('[deleted]') === '[deleted]');
const autoPseudo = anon('AutoModerator');
const exemplarComments = fs.readFileSync(path.join(exemplarDir, 'comments.csv'), 'utf8');
const autoCount = exemplarComments.split(`,${autoPseudo},`).length - 1;
check('anon.reversible_by_dictionary', autoCount > 0,
  `hash("AutoModerator") = ${autoPseudo}; appears ${autoCount} times in the exemplar comments`);
out.pseudonym = {
  scheme: '32-bit unsalted Java-style string hash (h = 31h + c), |h| in base 36, prefixed "user_"',
  output_space: 2 ** 31,
  automoderator_pseudonym: autoPseudo,
  automoderator_occurrences_in_exemplar: autoCount,
  // Birthday bound: probability of >=1 collision among n distinct usernames in a 2^31 space
  collision_probability: Object.fromEntries([1e3, 1e4, 1e5, 1e6].map(n => [n, +(1 - Math.exp(-(n * (n - 1)) / (2 * 2 ** 31))).toFixed(4)])),
};

out.summary = { total: Object.keys(out.checks).length, failed: failures };
fs.mkdirSync(path.join(PREPRINT, 'results'), { recursive: true });
fs.writeFileSync(path.join(PREPRINT, 'results/tool_verification.json'), JSON.stringify(out, null, 2));
console.log(`\n${out.summary.total - failures}/${out.summary.total} checks passed → results/tool_verification.json`);
process.exit(failures ? 1 : 0);
