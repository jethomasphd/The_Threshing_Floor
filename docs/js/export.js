/**
 * Export engine — CSV, JSON, JSONL with provenance sidecar.
 *
 * Every export is wrapped in a ZIP containing the data file and
 * provenance.txt documenting how the data was collected.
 */
'use strict';

window.Thresh = window.Thresh || {};

Thresh.Export = (function () {

  /* ---------- Provenance ---------- */

  /**
   * Generate provenance.txt content for a collection export.
   *
   * @param {Object} collection - The collection metadata.
   * @param {string} format - Export format (csv, json, jsonl).
   * @param {Object} options - Export options (anonymize, includeComments, filters).
   * @returns {string} The provenance document text.
   */
  function generateProvenance(collection, format, options) {
    options = options || {};
    const now = new Date();

    const lines = [
      '═══════════════════════════════════════════════════════',
      '  PROVENANCE DOCUMENT — The Threshing Floor v0.1.0',
      '═══════════════════════════════════════════════════════',
      '',
      'Tool:               The Threshing Floor (Thresh)',
      'Version:            0.1.0',
      'Export date:        ' + now.toISOString(),
      '',
      '── Data Source ──────────────────────────────────────',
      'Platform:           Reddit (public JSON feed)',
      'API endpoint:       www.reddit.com/*.json',
      'Subreddit:          r/' + collection.subreddit,
    ];

    if (collection.query) {
      lines.push('Search query:       ' + collection.query);
    }

    lines.push('Sort:               ' + (collection.sort || 'hot'));

    if (collection.timeFilter) {
      lines.push('Time filter:        ' + collection.timeFilter);
    }

    lines.push(
      'Requested limit:    ' + (collection.limit || '—'),
      '',
      '── Collection Results ──────────────────────────────',
      'Posts collected:     ' + (collection.postCount || 0),
      'Comments collected:  ' + (collection.commentCount || 0),
      'Collection date:    ' + (collection.createdAt || '—'),
      'Status:             ' + (collection.status || 'completed'),
      '',
      '── Export Options ──────────────────────────────────',
      'Format:             ' + format.toUpperCase(),
      'Usernames:          ' + (options.anonymize ? 'Anonymized (hashed)' : 'Included as-is'),
      'Comments included:  ' + (options.includeComments ? 'Yes' : 'No'),
    );

    if (options.minScore) {
      lines.push('Min score filter:   ' + options.minScore);
    }
    if (options.keyword) {
      lines.push('Keyword filter:     ' + options.keyword);
    }

    lines.push(
      '',
      '── Methodology Notes ──────────────────────────────',
      'Data was collected from Reddit\'s public JSON feeds via a client-side',
      'web application. Requests were routed through a CORS proxy and',
      'rate-limited to ~10 requests/minute to respect Reddit\'s servers.',
      '',
      'Reddit\'s API returns at most 100 items per request and limits',
      'listing depth to approximately 1000 items. Data represents a',
      'snapshot in time; scores, comment counts, and content may have',
      'changed since collection.',
      '',
      '── Ethics & Usage ─────────────────────────────────',
      'This data contains publicly posted content from Reddit.',
      'Researchers should be aware of:',
      '  - Re-identification risks even with anonymized usernames',
      '  - Reddit API Terms of Service (https://www.reddit.com/wiki/api)',
      '  - IRB/ethics board requirements for human subjects research',
      '  - Context collapse when analyzing posts outside their threads',
      '',
      '── Citation ───────────────────────────────────────',
      'If using this data in published work, consider citing:',
      '  Data collected via The Threshing Floor v0.1.0',
      '  (https://github.com/jethomasphd/The_Threshing_Floor)',
      '',
      '═══════════════════════════════════════════════════════',
    );

    return lines.join('\n');
  }

  /* ---------- Format helpers ---------- */

  /** Simple hash for username anonymization. */
  function hashUsername(name) {
    if (!name || name === '[deleted]') return '[deleted]';
    let h = 0;
    for (let i = 0; i < name.length; i++) {
      h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    }
    return 'user_' + Math.abs(h).toString(36);
  }

  function processPost(post, options) {
    const p = Object.assign({}, post);
    if (options.anonymize) {
      p.author = hashUsername(p.author);
    }
    return p;
  }

  /** CSV with UTF-8 BOM for Excel compatibility. */
  function toCSV(posts, options) {
    options = options || {};
    const cols = ['id', 'title', 'author', 'score', 'upvoteRatio', 'numComments', 'created', 'selftext', 'url', 'permalink', 'flair', 'subreddit'];

    function escapeCSV(val) {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const rows = [cols.join(',')];
    for (const post of posts) {
      const p = processPost(post, options);
      // Convert epoch to ISO
      if (p.created) p.created = new Date(p.created * 1000).toISOString();
      rows.push(cols.map(function (c) { return escapeCSV(p[c]); }).join(','));
    }

    // UTF-8 BOM
    return '\uFEFF' + rows.join('\n');
  }

  function toJSON(posts, options) {
    options = options || {};
    const processed = posts.map(function (p) { return processPost(p, options); });
    return JSON.stringify(processed, null, 2);
  }

  function toJSONL(posts, options) {
    options = options || {};
    return posts.map(function (p) {
      return JSON.stringify(processPost(p, options));
    }).join('\n');
  }

  /** Comments as CSV. */
  function commentsToCSV(comments, options) {
    options = options || {};
    const cols = ['id', 'author', 'body', 'score', 'created', 'parentId', 'depth'];

    function escapeCSV(val) {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const rows = [cols.join(',')];
    for (const comment of comments) {
      const c = Object.assign({}, comment);
      if (options.anonymize) c.author = hashUsername(c.author);
      if (c.created) c.created = new Date(c.created * 1000).toISOString();
      rows.push(cols.map(function (col) { return escapeCSV(c[col]); }).join(','));
    }
    return '\uFEFF' + rows.join('\n');
  }

  /* ---------- ZIP & Download ---------- */

  /**
   * Export a collection as a ZIP file containing data + provenance.txt.
   *
   * @param {Object} collection - The full collection object.
   * @param {string} format - 'csv', 'json', or 'jsonl'.
   * @param {Object} options - { anonymize, includeComments, minScore, keyword }.
   */
  async function exportCollection(collection, format, options) {
    options = options || {};
    format = format || 'csv';

    let posts = collection.posts || [];

    // Apply filters
    if (options.minScore) {
      const min = parseInt(options.minScore, 10);
      posts = posts.filter(function (p) { return p.score >= min; });
    }
    if (options.keyword) {
      const kw = options.keyword.toLowerCase();
      posts = posts.filter(function (p) {
        return (p.title && p.title.toLowerCase().includes(kw)) ||
               (p.selftext && p.selftext.toLowerCase().includes(kw));
      });
    }

    // Generate data file
    let dataContent, dataFilename;
    if (format === 'csv') {
      dataContent = toCSV(posts, options);
      dataFilename = 'posts.csv';
    } else if (format === 'jsonl') {
      dataContent = toJSONL(posts, options);
      dataFilename = 'posts.jsonl';
    } else {
      dataContent = toJSON(posts, options);
      dataFilename = 'posts.json';
    }

    // Generate provenance
    const provenance = generateProvenance(collection, format, options);

    // Build ZIP
    var zip = new JSZip();
    const folderName = 'thresh_' + collection.subreddit + '_' + new Date().toISOString().slice(0, 10);
    var folder = zip.folder(folderName);
    folder.file(dataFilename, dataContent);
    folder.file('provenance.txt', provenance);

    // Include comments if requested
    if (options.includeComments && collection.comments) {
      const allComments = [];
      for (const postId of Object.keys(collection.comments)) {
        for (const c of collection.comments[postId]) {
          allComments.push(c);
        }
      }
      if (allComments.length > 0) {
        if (format === 'csv') {
          folder.file('comments.csv', commentsToCSV(allComments, options));
        } else {
          const processedComments = allComments.map(function (c) {
            const cc = Object.assign({}, c);
            if (options.anonymize) cc.author = hashUsername(cc.author);
            return cc;
          });
          folder.file('comments.' + (format === 'jsonl' ? 'jsonl' : 'json'),
            format === 'jsonl'
              ? processedComments.map(function (c) { return JSON.stringify(c); }).join('\n')
              : JSON.stringify(processedComments, null, 2));
        }
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });

    // Download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = folderName + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    Thresh.Storage.recordExport();
  }

  return {
    generateProvenance: generateProvenance,
    exportCollection: exportCollection,
    toCSV: toCSV,
    toJSON: toJSON,
    toJSONL: toJSONL,
  };
})();
