/**
 * Client-side export engine.
 * Generates CSV, JSON, and provenance.txt, bundled into a ZIP.
 */

const Exporter = {
  /**
   * Export collection data as a downloadable ZIP.
   * @param {Object} collection - The collection data (posts, config, timestamp)
   * @param {Object} options - { format: 'csv'|'json', anonymize: boolean }
   */
  async exportZip(collection, options = {}) {
    const { format = 'csv', anonymize = true } = options;
    const { posts, comments, config, timestamp } = collection;

    // Prepare post data
    let exportPosts = posts.map(p => this._flattenPost(p, anonymize));

    // Generate provenance
    const provenance = this._generateProvenance(collection, options);

    // Create ZIP
    const zip = new JSZip();
    const folderName = `thresh_${config.subreddit.replace(/,/g, '_')}_${this._dateStamp()}`;
    const folder = zip.folder(folderName);

    if (format === 'csv') {
      folder.file('posts.csv', this._toCSV(exportPosts));
      if (comments && comments.length > 0) {
        const exportComments = comments.map(c => this._flattenComment(c, anonymize));
        folder.file('comments.csv', this._toCSV(exportComments));
      }
    } else {
      folder.file('posts.json', JSON.stringify(exportPosts, null, 2));
      if (comments && comments.length > 0) {
        const exportComments = comments.map(c => this._flattenComment(c, anonymize));
        folder.file('comments.json', JSON.stringify(exportComments, null, 2));
      }
    }

    folder.file('provenance.txt', provenance);

    // Generate and download
    const blob = await zip.generateAsync({ type: 'blob' });
    this._downloadBlob(blob, `${folderName}.zip`);
  },

  /**
   * Generate a preview of the export data (first few rows).
   */
  preview(collection, options = {}) {
    const { format = 'csv', anonymize = true } = options;
    const { posts } = collection;
    const sample = posts.slice(0, 5).map(p => this._flattenPost(p, anonymize));

    if (format === 'csv') {
      return this._toCSV(sample);
    }
    return JSON.stringify(sample, null, 2);
  },

  /**
   * Flatten a post object for export.
   */
  _flattenPost(post, anonymize) {
    const flat = {
      id: post.id,
      subreddit: post.subreddit,
      title: post.title,
      author: anonymize ? this._anonymize(post.author) : post.author,
      selftext: post.selftext,
      score: post.score,
      upvote_ratio: post.upvote_ratio,
      num_comments: post.num_comments,
      created_utc: post.created_utc,
      created_date: new Date(post.created_utc * 1000).toISOString(),
      url: post.url,
      permalink: post.permalink,
      is_self: post.is_self,
      flair: post.link_flair_text,
      domain: post.domain,
    };
    return flat;
  },

  /**
   * Flatten a comment for export.
   */
  _flattenComment(comment, anonymize) {
    return {
      id: comment.id,
      post_id: comment.post_id || '',
      author: anonymize ? this._anonymize(comment.author) : comment.author,
      body: comment.body,
      score: comment.score,
      created_utc: comment.created_utc,
      created_date: new Date(comment.created_utc * 1000).toISOString(),
      depth: comment.depth,
      parent_id: comment.parent_id,
    };
  },

  /**
   * Generate provenance document.
   */
  _generateProvenance(collection, options) {
    const { config, posts, comments, timestamp } = collection;
    const { format = 'csv', anonymize = true } = options;

    const lines = [
      '═══════════════════════════════════════════════════════════',
      '  PROVENANCE — The Threshing Floor',
      '  Data Collection Methodology Record',
      '═══════════════════════════════════════════════════════════',
      '',
      'TOOL',
      `  Name: The Threshing Floor (Cloudflare Pages Edition)`,
      `  Version: 1.0.0`,
      `  Method: Reddit public JSON endpoints (no API authentication)`,
      '',
      'COLLECTION PARAMETERS',
      `  Subreddit(s): ${config.subreddit}`,
      `  Sort: ${config.sort}`,
      `  Time filter: ${config.timeFilter}`,
      `  Max posts requested: ${config.limit}`,
      `  Keyword filter: ${config.keyword || '(none)'}`,
      `  Include comments: ${config.includeComments ? 'yes' : 'no'}`,
      '',
      'RESULTS',
      `  Posts collected: ${posts.length}`,
      `  Comments collected: ${comments ? comments.length : 0}`,
      `  Collection timestamp (UTC): ${timestamp}`,
      '',
      'EXPORT',
      `  Format: ${format.toUpperCase()}`,
      `  Authors anonymized: ${anonymize ? 'yes' : 'no'}`,
      `  Export timestamp (UTC): ${new Date().toISOString()}`,
      '',
      'DATA SOURCE',
      `  Endpoint: https://www.reddit.com/r/{subreddit}/{sort}.json`,
      `  Access method: Public JSON (no OAuth, no API key)`,
      `  Proxied through: Cloudflare Pages Function (CORS proxy only)`,
      '',
      'LIMITATIONS & NOTES',
      `  - Reddit's public JSON endpoints return a maximum of ~100 posts per request`,
      `  - Post scores and comment counts reflect values at collection time`,
      `  - Deleted or removed posts/comments are excluded`,
      `  - Comment depth limited to 2 levels for performance`,
      `  - Data represents a point-in-time snapshot, not a continuous feed`,
      '',
      'ETHICAL USE',
      `  - This data was collected from publicly accessible Reddit posts`,
      `  - Researchers should consider re-identification risks`,
      `  - Consult your IRB before using in human subjects research`,
      `  - See: https://www.reddit.com/wiki/api-terms`,
      '',
      '═══════════════════════════════════════════════════════════',
      `  Generated by The Threshing Floor`,
      `  A Jacob E. Thomas artifact`,
      '═══════════════════════════════════════════════════════════',
    ];

    return lines.join('\n');
  },

  /**
   * Convert array of objects to CSV string (UTF-8 BOM for Excel).
   */
  _toCSV(rows) {
    if (!rows.length) return '';

    const headers = Object.keys(rows[0]);
    const BOM = '\uFEFF';

    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const csvRows = [
      headers.map(escape).join(','),
      ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
    ];

    return BOM + csvRows.join('\r\n');
  },

  /**
   * Anonymize a username.
   */
  _anonymize(username) {
    if (!username || username === '[deleted]') return '[deleted]';
    // Simple hash-based anonymization
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      const char = username.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `user_${Math.abs(hash).toString(36).slice(0, 8)}`;
  },

  /**
   * Generate a datestamp for filenames.
   */
  _dateStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  },

  /**
   * Trigger a file download in the browser.
   */
  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
