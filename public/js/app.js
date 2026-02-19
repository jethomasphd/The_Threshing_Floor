/**
 * The Threshing Floor — Main Application
 * Client-side SPA orchestrator: routing, state, UI binding.
 */

const ThreshApp = {
  // --- State ---
  collections: [],       // Array of { id, posts, comments, config, timestamp }
  activeCollection: null, // Currently viewed collection
  harvestSort: { field: 'score', dir: 'desc' },
  harvestFilter: '',

  // --- Initialization ---

  _countdownInterval: null,

  init() {
    // Load saved collections from localStorage
    this._loadCollections();

    // Run intro animation
    this._runIntro();

    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // Show/hide custom prompt field
    const promptSelect = document.getElementById('winnow-prompt');
    if (promptSelect) {
      promptSelect.addEventListener('change', () => {
        const group = document.getElementById('winnow-custom-group');
        group.style.display = promptSelect.value === 'custom' ? 'block' : 'none';
      });
    }

    // Update collection selectors
    this._updateSelectors();

    // Wire up rate limit sentinel
    this._initRateSentinel();
  },

  // --- Intro ---

  _runIntro() {
    const elements = document.querySelectorAll('#intro-content > *');
    elements.forEach(el => {
      const delay = parseInt(el.dataset.delay || '0', 10);
      setTimeout(() => el.classList.add('visible'), delay);
    });
  },

  enterApp(skipAnimation) {
    const intro = document.getElementById('intro');
    const app = document.getElementById('app');

    if (skipAnimation) {
      intro.style.display = 'none';
      app.style.display = 'block';
    } else {
      intro.classList.add('intro-hidden');
      setTimeout(() => {
        intro.style.display = 'none';
        app.style.display = 'block';
      }, 1200);
    }

    // Re-init icons after app becomes visible
    setTimeout(() => {
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 100);
  },

  // --- Navigation ---

  navigate(page) {
    // Hide all pages
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

    // Show target page
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    // Update sidebar
    document.querySelectorAll('.sidebar-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Update mobile nav
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Page-specific setup
    if (page === 'harvest') this._setupHarvest();
    if (page === 'glean') this._setupGlean();
    if (page === 'winnow') this._setupWinnow();
    if (page === 'floor') this._updateFloorRecent();

    // Re-init icons
    setTimeout(() => {
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 50);
  },

  // --- Collection ---

  async startCollection(event) {
    event.preventDefault();

    const config = {
      subreddit: document.getElementById('subreddit').value.trim(),
      sort: document.getElementById('sort').value,
      timeFilter: document.getElementById('time-filter').value,
      limit: parseInt(document.getElementById('limit').value, 10),
      keyword: document.getElementById('keyword').value.trim(),
      includeComments: document.getElementById('include-comments').checked,
    };

    if (!config.subreddit) {
      this.toast('Please enter a subreddit name.', 'warning');
      return false;
    }

    // Check rate limit before starting
    if (RateLimiter.isBlocked()) {
      const secs = RateLimiter.blockSecondsLeft();
      this.toast(`Rate limited — please wait ${secs} seconds before collecting.`, 'warning');
      return false;
    }

    // Show progress
    const progressEl = document.getElementById('thresh-progress');
    const submitBtn = document.getElementById('thresh-submit');
    const statusEl = document.getElementById('thresh-status');

    progressEl.style.display = 'block';
    submitBtn.disabled = true;
    statusEl.textContent = '';

    try {
      const result = await RedditClient.collect(config, (progress) => {
        document.getElementById('progress-message').textContent = progress.message;
        document.getElementById('progress-count').textContent = `${progress.current} posts`;
        const pct = progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : 0;
        document.getElementById('progress-bar').style.width = `${pct}%`;
      });

      if (result.posts.length === 0) {
        this.toast('No posts found. Try a different subreddit or search term.', 'warning');
        progressEl.style.display = 'none';
        submitBtn.disabled = false;
        return false;
      }

      // Save collection
      const collection = {
        id: Date.now().toString(36),
        ...result,
      };

      this.collections.push(collection);
      this._saveCollections();
      this._updateSelectors();

      // Show success
      document.getElementById('progress-bar').style.width = '100%';
      document.getElementById('progress-message').textContent = 'Collection complete!';
      this.toast(`Collected ${result.posts.length} posts from r/${config.subreddit}`, 'success');

      // Navigate to harvest after brief delay
      setTimeout(() => {
        progressEl.style.display = 'none';
        submitBtn.disabled = false;
        this.activeCollection = collection;
        this.navigate('harvest');
        this._renderHarvest();
      }, 1500);

    } catch (err) {
      if (err.message.includes('Rate limited')) {
        this.toast(err.message, 'warning');
        // Keep button disabled — sentinel countdown will re-enable it
        submitBtn.disabled = true;
      } else {
        this.toast(`Collection failed: ${err.message}`, 'error');
        submitBtn.disabled = false;
      }
      progressEl.style.display = 'none';
    }

    return false;
  },

  // --- Harvest ---

  _setupHarvest() {
    const select = document.getElementById('harvest-collection');
    this._populateCollectionSelect(select);

    const hasData = this.collections.length > 0;
    document.getElementById('harvest-empty').style.display = hasData ? 'none' : 'flex';
    document.getElementById('harvest-results').style.display = hasData && this.activeCollection ? 'block' : 'none';

    if (this.activeCollection) {
      select.value = this.activeCollection.id;
      this._renderHarvest();
    }
  },

  loadCollection(id) {
    if (!id) {
      this.activeCollection = null;
      document.getElementById('harvest-results').style.display = 'none';
      document.getElementById('harvest-empty').style.display = 'flex';
      return;
    }

    this.activeCollection = this.collections.find(c => c.id === id);
    if (this.activeCollection) {
      document.getElementById('harvest-empty').style.display = 'none';
      document.getElementById('harvest-results').style.display = 'block';
      this._renderHarvest();
    }
  },

  _renderHarvest() {
    if (!this.activeCollection) return;
    const { posts, config, timestamp } = this.activeCollection;

    // Stats
    const statsEl = document.getElementById('harvest-stats');
    const avgScore = posts.length ? Math.round(posts.reduce((s, p) => s + p.score, 0) / posts.length) : 0;
    const avgComments = posts.length ? Math.round(posts.reduce((s, p) => s + p.num_comments, 0) / posts.length) : 0;
    const dateRange = posts.length ? this._dateRange(posts) : 'N/A';

    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat"><span class="stat-value">${posts.length}</span><span class="stat-label">Posts</span></div></div>
      <div class="stat-card"><div class="stat"><span class="stat-value">${avgScore}</span><span class="stat-label">Avg Score</span></div></div>
      <div class="stat-card"><div class="stat"><span class="stat-value">${avgComments}</span><span class="stat-label">Avg Comments</span></div></div>
      <div class="stat-card"><div class="stat"><span class="stat-value text-sm">${dateRange}</span><span class="stat-label">Date Range</span></div></div>
    `;

    this._renderHarvestTable();
  },

  _renderHarvestTable() {
    if (!this.activeCollection) return;

    let posts = [...this.activeCollection.posts];

    // Filter
    if (this.harvestFilter) {
      const q = this.harvestFilter.toLowerCase();
      posts = posts.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        (p.selftext && p.selftext.toLowerCase().includes(q))
      );
    }

    // Sort
    const { field, dir } = this.harvestSort;
    posts.sort((a, b) => {
      let va = a[field], vb = b[field];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    document.getElementById('harvest-count').textContent = `${posts.length} posts`;

    const tbody = document.getElementById('harvest-tbody');
    tbody.innerHTML = posts.map(p => {
      const date = new Date(p.created_utc * 1000);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const titleTrunc = p.title.length > 80 ? p.title.slice(0, 80) + '...' : p.title;

      return `<tr onclick="ThreshApp.showPostDetail('${p.id}')" style="cursor:pointer">
        <td style="max-width:350px;"><span class="post-title-link">${this._escapeHtml(titleTrunc)}</span></td>
        <td class="text-ash text-xs">${this._escapeHtml(p.author)}</td>
        <td style="text-align:right;" class="text-ember">${p.score.toLocaleString()}</td>
        <td style="text-align:right;">${p.num_comments.toLocaleString()}</td>
        <td class="text-ash text-xs" style="white-space:nowrap;">${dateStr}</td>
      </tr>`;
    }).join('');
  },

  filterHarvest() {
    this.harvestFilter = document.getElementById('harvest-search').value.trim();
    this._renderHarvestTable();
  },

  sortHarvest(field) {
    if (this.harvestSort.field === field) {
      this.harvestSort.dir = this.harvestSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this.harvestSort.field = field;
      this.harvestSort.dir = field === 'title' || field === 'author' ? 'asc' : 'desc';
    }
    this._renderHarvestTable();
  },

  showPostDetail(postId) {
    if (!this.activeCollection) return;
    const post = this.activeCollection.posts.find(p => p.id === postId);
    if (!post) return;

    const detailEl = document.getElementById('post-detail');
    document.getElementById('detail-title').textContent = post.title;

    const bodyEl = document.getElementById('detail-body');
    if (post.selftext) {
      bodyEl.innerHTML = `<div class="post-body-preview visible">${this._escapeHtml(post.selftext)}</div>`;
    } else {
      bodyEl.innerHTML = `<a href="${this._escapeHtml(post.url)}" target="_blank" rel="noopener" class="text-link text-sm">External link: ${this._escapeHtml(post.domain)}</a>`;
    }

    // Comments
    const commentsEl = document.getElementById('detail-comments');
    if (post.fetched_comments && post.fetched_comments.length > 0) {
      commentsEl.innerHTML = `
        <h5 style="margin-bottom:0.5rem;color:var(--bone-muted);">Comments (${post.fetched_comments.length})</h5>
        <div class="comment-tree">
          ${post.fetched_comments.map(c => `
            <div class="comment-item" style="margin-left:${c.depth * 1}rem;">
              <div class="comment-meta">
                <span class="text-ember">${this._escapeHtml(c.author)}</span>
                <span>&middot;</span>
                <span>${c.score} pts</span>
              </div>
              <div class="comment-body">${this._escapeHtml(c.body)}</div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      commentsEl.innerHTML = '<p class="text-ash text-sm">No comments collected for this post.</p>';
    }

    detailEl.style.display = 'block';
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  // --- Glean (Export) ---

  _setupGlean() {
    const select = document.getElementById('glean-collection');
    this._populateCollectionSelect(select);

    const hasData = this.collections.length > 0;
    document.getElementById('glean-empty').style.display = hasData ? 'none' : 'flex';
    document.getElementById('glean-panel').style.display = hasData ? 'block' : 'none';

    if (this.activeCollection) {
      select.value = this.activeCollection.id;
    }
  },

  updateGleanPreview() {
    const id = document.getElementById('glean-collection').value;
    if (id) {
      this.activeCollection = this.collections.find(c => c.id === id);
    }
  },

  previewExport() {
    const id = document.getElementById('glean-collection').value;
    const collection = this.collections.find(c => c.id === id);
    if (!collection) {
      this.toast('Select a collection first.', 'warning');
      return;
    }

    const format = document.getElementById('export-format').value;
    const anonymize = document.getElementById('anonymize-authors').checked;

    const preview = Exporter.preview(collection, { format, anonymize });

    document.getElementById('glean-preview').textContent = preview;
    document.getElementById('glean-preview-container').style.display = 'block';
  },

  async exportData() {
    const id = document.getElementById('glean-collection').value;
    const collection = this.collections.find(c => c.id === id);
    if (!collection) {
      this.toast('Select a collection first.', 'warning');
      return;
    }

    const format = document.getElementById('export-format').value;
    const anonymize = document.getElementById('anonymize-authors').checked;

    try {
      await Exporter.exportZip(collection, { format, anonymize });
      this.toast('Export downloaded! Check your downloads folder.', 'success');
    } catch (err) {
      this.toast(`Export failed: ${err.message}`, 'error');
    }
  },

  // --- Winnow (AI Analysis) ---

  _setupWinnow() {
    const select = document.getElementById('winnow-collection');
    this._populateCollectionSelect(select);

    const hasData = this.collections.length > 0;
    document.getElementById('winnow-empty').style.display = hasData ? 'none' : 'flex';
    document.getElementById('winnow-panel').style.display = hasData ? 'block' : 'none';

    if (this.activeCollection) {
      select.value = this.activeCollection.id;
      this._renderWordFreqTable();
      this._renderTemporalChart();
    }
  },

  loadWinnowCollection(id) {
    if (!id) {
      this.activeCollection = null;
      return;
    }
    this.activeCollection = this.collections.find(c => c.id === id);
    if (this.activeCollection) {
      this._renderWordFreqTable();
      this._renderTemporalChart();
    }
  },

  // --- AI Loading Indicator ---

  _aiProgressInterval: null,

  _startAiProgress(statusEl, estimatedSeconds = 20) {
    let elapsed = 0;
    const steps = [
      { at: 0, msg: 'Sending data to Claude...' },
      { at: 3, msg: 'Claude is reading your posts...' },
      { at: 8, msg: 'Analyzing patterns and themes...' },
      { at: 15, msg: 'Structuring the response...' },
      { at: 25, msg: 'Almost there — finalizing...' },
      { at: 45, msg: 'Still working — large datasets take longer...' },
      { at: 75, msg: 'This is taking a while — hang tight...' },
    ];
    let stepIdx = 0;

    statusEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.5rem;">
      <span class="ai-spinner"></span>
      <span id="ai-progress-text">${steps[0].msg}</span>
      <span id="ai-progress-time" class="text-ash" style="font-size:0.75rem;"></span>
    </span>`;

    this._aiProgressInterval = setInterval(() => {
      elapsed++;
      const textEl = document.getElementById('ai-progress-text');
      const timeEl = document.getElementById('ai-progress-time');
      if (textEl && stepIdx < steps.length - 1 && elapsed >= steps[stepIdx + 1].at) {
        stepIdx++;
        textEl.textContent = steps[stepIdx].msg;
      }
      if (timeEl) timeEl.textContent = `${elapsed}s`;
    }, 1000);
  },

  _stopAiProgress(statusEl) {
    if (this._aiProgressInterval) {
      clearInterval(this._aiProgressInterval);
      this._aiProgressInterval = null;
    }
    statusEl.innerHTML = '';
  },

  async runAnalysis() {
    const id = document.getElementById('winnow-collection').value;
    const collection = this.collections.find(c => c.id === id);
    if (!collection) {
      this.toast('Select a collection first.', 'warning');
      return;
    }

    const analysisType = document.getElementById('winnow-prompt').value;
    const customPrompt = document.getElementById('winnow-custom').value;
    const statusEl = document.getElementById('winnow-status');
    const btn = document.querySelector('#page-winnow .btn-primary');
    if (btn) btn.disabled = true;

    this._startAiProgress(statusEl, 20);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

      const result = await ClaudeClient.analyze(collection.posts, analysisType, customPrompt);
      clearTimeout(timeout);

      this._stopAiProgress(statusEl);
      document.getElementById('winnow-response').textContent = result;
      document.getElementById('winnow-result').style.display = 'block';
      this.toast('Analysis complete!', 'success');
    } catch (err) {
      this._stopAiProgress(statusEl);
      if (err.name === 'AbortError') {
        this.toast('Analysis timed out after 2 minutes. Try a smaller collection or a simpler analysis type.', 'error');
      } else {
        this.toast(`Analysis failed: ${err.message}`, 'error');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  _wordFreqData: [],

  _renderWordFreqTable() {
    if (!this.activeCollection) return;

    const wrap = document.getElementById('word-freq-table-wrap');
    const copyBtn = document.getElementById('word-freq-copy');
    if (!wrap) return;

    // Simple word frequency (client-side, no API needed)
    const stopwords = new Set([
      'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with',
      'he','as','you','do','at','this','but','his','by','from','they','we','her','she','or',
      'an','will','my','one','all','would','there','their','what','so','up','out','if','about',
      'who','get','which','go','me','when','make','can','like','time','no','just','him','know',
      'take','people','into','year','your','good','some','could','them','see','other','than',
      'then','now','look','only','come','its','over','think','also','back','after','use','two',
      'how','our','work','first','well','way','even','new','want','because','any','these',
      'give','day','most','us','been','has','had','was','were','are','is','am','im','dont',
      'really','much','very','more','still','should','did','got','going','being','been','may',
      'own','through','too','does','need','say','each','tell','why','ask','men','ran','try',
      'every','where','between','never','another','while','last','might','found','before',
      'same','made','long','right','said','many','thing','things','something','anything','man',
      'woman','life','world','let','keep','being','down','over','such','against','here','both',
      'those','put','went','came','off','around','since','still','set','few','without',
      'already','sure','nothing','point','someone','everyone','everything','lot','feel',
      'felt','actually','doing','done','went','thought','getting','making','big','put','old',
      'great','around','little','part','every','again','change','went','says','http','https',
      'www','com','reddit','removed','deleted',
    ]);

    const allText = this.activeCollection.posts
      .map(p => `${p.title} ${p.selftext || ''}`)
      .join(' ')
      .toLowerCase();

    const words = allText
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w));

    const totalWords = words.length;
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    this._wordFreqData = sorted;

    if (sorted.length === 0) {
      wrap.innerHTML = '<p class="text-ash text-sm" style="text-align:center;padding:2rem 0;">No words found after filtering stopwords.</p>';
      if (copyBtn) copyBtn.style.display = 'none';
      return;
    }

    const maxCount = sorted[0][1];

    wrap.innerHTML = `
      <table class="data-table" style="width:100%;">
        <thead>
          <tr>
            <th style="width:2.5rem;text-align:right;">#</th>
            <th>Word</th>
            <th style="text-align:right;width:5rem;">Count</th>
            <th style="text-align:right;width:4.5rem;">% of total</th>
            <th style="width:40%;">Frequency</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(([word, count], i) => {
            const pct = ((count / totalWords) * 100).toFixed(1);
            const barWidth = Math.round((count / maxCount) * 100);
            return `<tr>
              <td style="text-align:right;" class="text-ash">${i + 1}</td>
              <td class="font-mono text-bone">${this._escapeHtml(word)}</td>
              <td style="text-align:right;" class="font-mono text-ember">${count.toLocaleString()}</td>
              <td style="text-align:right;" class="font-mono text-ash">${pct}%</td>
              <td>
                <div style="background:var(--smoke);border-radius:2px;height:8px;overflow:hidden;">
                  <div style="width:${barWidth}%;height:100%;background:var(--ember);border-radius:2px;opacity:0.7;"></div>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p class="text-ash text-xs" style="margin-top:0.5rem;">${totalWords.toLocaleString()} total words analyzed from ${this.activeCollection.posts.length} posts.</p>
    `;

    if (copyBtn) copyBtn.style.display = 'flex';

    // Re-init icons
    setTimeout(() => {
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 50);
  },

  copyWordFreq() {
    if (!this._wordFreqData.length) return;

    const lines = ['Rank\tWord\tCount'];
    this._wordFreqData.forEach(([word, count], i) => {
      lines.push(`${i + 1}\t${word}\t${count}`);
    });

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      this.toast('Word frequency table copied to clipboard.', 'success');
    }).catch(() => {
      this.toast('Could not copy — try selecting the table manually.', 'warning');
    });
  },

  _temporalChart: null,

  _renderTemporalChart() {
    const wrap = document.getElementById('temporal-chart-wrap');
    if (!wrap || !this.activeCollection) return;

    if (typeof Chart === 'undefined') {
      wrap.innerHTML = '<p class="text-ash text-sm" style="text-align:center;padding:2rem 0;">Chart library not loaded.</p>';
      return;
    }

    const posts = this.activeCollection.posts;
    if (!posts.length) return;

    // Group posts by date
    const dateCounts = {};
    posts.forEach(p => {
      const date = new Date(p.created_utc * 1000).toISOString().slice(0, 10);
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    });

    // Sort by date and fill gaps
    const dates = Object.keys(dateCounts).sort();
    if (dates.length < 2) {
      // Not enough date spread for a meaningful chart
      wrap.innerHTML = '<p class="text-ash text-sm" style="text-align:center;padding:2rem 0;">All posts from the same day — no temporal spread to chart.</p>';
      return;
    }

    // Fill in missing dates with 0
    const start = new Date(dates[0]);
    const end = new Date(dates[dates.length - 1]);
    const labels = [];
    const values = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      labels.push(key);
      values.push(dateCounts[key] || 0);
    }

    // Destroy previous chart if exists
    if (this._temporalChart) {
      this._temporalChart.destroy();
    }

    // Create canvas
    wrap.innerHTML = '<canvas id="temporal-chart"></canvas>';
    const ctx = document.getElementById('temporal-chart').getContext('2d');

    // Determine label format based on date range
    const rangeDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
    const formatDate = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      if (rangeDays <= 14) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (rangeDays <= 90) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };

    this._temporalChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.map(formatDate),
        datasets: [{
          label: 'Posts',
          data: values,
          borderColor: '#C9A227',
          backgroundColor: 'rgba(201, 162, 39, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: values.length > 60 ? 0 : 3,
          pointBackgroundColor: '#C9A227',
          pointBorderColor: '#C9A227',
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1A1A22',
            titleColor: '#E8E4DC',
            bodyColor: '#A8A49C',
            borderColor: 'rgba(201, 162, 39, 0.3)',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => `${item.raw} post${item.raw !== 1 ? 's' : ''}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#6B6B7B',
              font: { family: 'IBM Plex Mono', size: 10 },
              maxTicksLimit: 10,
              maxRotation: 45,
            },
            grid: { color: 'rgba(61, 61, 74, 0.3)' },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#6B6B7B',
              font: { family: 'IBM Plex Mono', size: 10 },
              stepSize: 1,
              precision: 0,
            },
            grid: { color: 'rgba(61, 61, 74, 0.3)' },
            title: {
              display: true,
              text: 'Posts',
              color: '#6B6B7B',
              font: { family: 'IBM Plex Sans', size: 11 },
            },
          },
        },
      },
    });
  },

  copyAnalysis() {
    const responseEl = document.getElementById('winnow-response');
    if (!responseEl || !responseEl.textContent.trim()) {
      this.toast('No analysis to copy yet.', 'warning');
      return;
    }

    navigator.clipboard.writeText(responseEl.textContent).then(() => {
      this.toast('Analysis copied to clipboard.', 'success');
    }).catch(() => {
      this.toast('Could not copy — try selecting the text manually.', 'warning');
    });
  },

  downloadAnalysis(format) {
    const responseEl = document.getElementById('winnow-response');
    if (!responseEl || !responseEl.textContent.trim()) {
      this.toast('No analysis to download yet.', 'warning');
      return;
    }

    const text = responseEl.textContent;
    const collection = this.activeCollection;
    const sub = collection ? collection.config.subreddit : 'unknown';
    const date = new Date().toISOString().slice(0, 10);

    // Build a header with provenance context
    const header = [
      `Analysis generated by The Threshing Floor`,
      `Date: ${new Date().toISOString()}`,
      `Subreddit(s): r/${sub}`,
      collection ? `Posts analyzed: ${collection.posts.length}` : '',
      collection ? `Collection method: ${collection.config.sort}, time filter: ${collection.config.timeFilter}` : '',
      collection && collection.config.keyword ? `Keyword filter: "${collection.config.keyword}"` : '',
      `---`,
      '',
    ].filter(Boolean).join('\n');

    const fullText = header + text;
    const ext = format === 'md' ? 'md' : 'txt';
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
    const filename = `thresh-analysis-${sub.replace(/,/g, '-')}-${date}.${ext}`;

    const blob = new Blob([fullText], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.toast(`Analysis saved as ${filename}`, 'success');
  },

  // --- Research Report Generation ---

  async generateResearchReport() {
    const id = document.getElementById('glean-collection').value;
    const collection = this.collections.find(c => c.id === id);
    if (!collection) {
      this.toast('Select a collection first.', 'warning');
      return;
    }

    const question = document.getElementById('report-question').value.trim();
    if (!question) {
      this.toast('Please enter a research question so Claude can frame the report.', 'warning');
      return;
    }

    const audience = document.getElementById('report-audience').value;
    const context = document.getElementById('report-context').value.trim();
    const statusEl = document.getElementById('report-status');
    const btn = document.getElementById('report-generate-btn');

    btn.disabled = true;
    this._startAiProgress(statusEl, 45);

    try {
      // Compute word frequency for the report
      const wordFreq = this._computeWordFreq(collection.posts);

      // Compute summary stats
      const posts = collection.posts;
      const avgScore = posts.length ? Math.round(posts.reduce((s, p) => s + p.score, 0) / posts.length) : 0;
      const avgComments = posts.length ? Math.round(posts.reduce((s, p) => s + p.num_comments, 0) / posts.length) : 0;
      const dateRange = posts.length ? this._dateRange(posts) : 'N/A';

      const stats = {
        postCount: posts.length,
        avgScore,
        avgComments,
        dateRange,
      };

      const result = await ClaudeClient.generateReport({
        posts: collection.posts,
        config: collection.config,
        timestamp: collection.timestamp,
        wordFreq,
        stats,
        question,
        audience,
        context,
      });

      // Store the report text for download
      this._lastReport = result;
      this._lastReportMeta = { collection, question, audience };

      this._stopAiProgress(statusEl);
      document.getElementById('report-response').textContent = result;
      document.getElementById('report-result').style.display = 'block';
      document.getElementById('report-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      btn.disabled = false;
      this.toast('Research report generated!', 'success');
    } catch (err) {
      this._stopAiProgress(statusEl);
      btn.disabled = false;
      this.toast(`Report generation failed: ${err.message}`, 'error');
    }
  },

  _computeWordFreq(posts) {
    const stopwords = new Set([
      'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with',
      'he','as','you','do','at','this','but','his','by','from','they','we','her','she','or',
      'an','will','my','one','all','would','there','their','what','so','up','out','if','about',
      'who','get','which','go','me','when','make','can','like','time','no','just','him','know',
      'take','people','into','year','your','good','some','could','them','see','other','than',
      'then','now','look','only','come','its','over','think','also','back','after','use','two',
      'how','our','work','first','well','way','even','new','want','because','any','these',
      'give','day','most','us','been','has','had','was','were','are','is','am','im','dont',
      'really','much','very','more','still','should','did','got','going','being','been','may',
      'own','through','too','does','need','say','each','tell','why','ask','men','ran','try',
      'every','where','between','never','another','while','last','might','found','before',
      'same','made','long','right','said','many','thing','things','something','anything','man',
      'woman','life','world','let','keep','being','down','over','such','against','here','both',
      'those','put','went','came','off','around','since','still','set','few','without',
      'already','sure','nothing','point','someone','everyone','everything','lot','feel',
      'felt','actually','doing','done','went','thought','getting','making','big','put','old',
      'great','around','little','part','every','again','change','went','says','http','https',
      'www','com','reddit','removed','deleted',
    ]);
    const allText = posts.map(p => `${p.title} ${p.selftext || ''}`).join(' ').toLowerCase();
    const words = allText.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20);
  },

  _lastReport: '',
  _lastReportMeta: null,

  downloadReport() {
    if (!this._lastReport) {
      this.toast('No report to download yet.', 'warning');
      return;
    }

    const meta = this._lastReportMeta;
    const sub = meta && meta.collection ? meta.collection.config.subreddit : 'unknown';
    const date = new Date().toISOString().slice(0, 10);
    const filename = `thresh-report-${sub.replace(/,/g, '-')}-${date}.md`;

    const blob = new Blob([this._lastReport], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.toast(`Report saved as ${filename}`, 'success');
  },

  async downloadReportDocx() {
    if (!this._lastReport) {
      this.toast('No report to download yet.', 'warning');
      return;
    }

    if (typeof docx === 'undefined') {
      this.toast('DOCX library not loaded. Falling back to Markdown download.', 'warning');
      this.downloadReport();
      return;
    }

    try {
      const meta = this._lastReportMeta;
      const sub = meta && meta.collection ? meta.collection.config.subreddit : 'unknown';
      const date = new Date().toISOString().slice(0, 10);
      const filename = `thresh-report-${sub.replace(/,/g, '-')}-${date}.docx`;

      const {
        Document, Packer, Paragraph, TextRun, HeadingLevel,
        AlignmentType, BorderStyle, TabStopPosition, TabStopType,
        PageBreak, Table, TableRow, TableCell, WidthType, ShadingType,
        Footer, Header, ExternalHyperlink,
      } = docx;

      // Parse Markdown into structured blocks
      const blocks = this._parseMarkdownBlocks(this._lastReport);

      // Build document children from parsed blocks
      const children = [];

      // Title page
      children.push(new Paragraph({ spacing: { before: 3000 } }));

      // Find the report title from the first H1
      let reportTitle = 'Research Report';
      const firstH1 = blocks.find(b => b.type === 'h1');
      if (firstH1) reportTitle = firstH1.text;

      children.push(new Paragraph({
        children: [new TextRun({
          text: reportTitle,
          font: 'Georgia',
          size: 52,
          color: '2D2D2D',
          bold: true,
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }));

      // Divider line
      children.push(new Paragraph({
        children: [new TextRun({ text: '', font: 'Georgia' })],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9A227', space: 1 },
        },
        spacing: { after: 400 },
      }));

      // Subtitle: generated info
      children.push(new Paragraph({
        children: [new TextRun({
          text: `Generated by The Threshing Floor`,
          font: 'Calibri',
          size: 22,
          color: '666666',
          italics: true,
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }));

      children.push(new Paragraph({
        children: [new TextRun({
          text: `r/${sub} — ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
          font: 'Calibri',
          size: 22,
          color: '666666',
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      }));

      if (meta && meta.question) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: 'Research Question: ', font: 'Calibri', size: 22, color: '666666', bold: true }),
            new TextRun({ text: meta.question, font: 'Calibri', size: 22, color: '666666', italics: true }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        }));
      }

      // Page break after title page
      children.push(new Paragraph({
        children: [new PageBreak()],
      }));

      // Render all content blocks (skip the first H1 since we used it as title)
      let skippedFirstH1 = false;
      for (const block of blocks) {
        if (block.type === 'h1' && !skippedFirstH1) {
          skippedFirstH1 = true;
          continue;
        }

        if (block.type === 'h1') {
          children.push(new Paragraph({
            children: [new TextRun({
              text: block.text,
              font: 'Georgia',
              size: 36,
              color: '2D2D2D',
              bold: true,
            })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 480, after: 200 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 2, color: 'C9A227', space: 4 },
            },
          }));
        } else if (block.type === 'h2') {
          children.push(new Paragraph({
            children: [new TextRun({
              text: block.text,
              font: 'Georgia',
              size: 30,
              color: '3D3D3D',
              bold: true,
            })],
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 360, after: 160 },
          }));
        } else if (block.type === 'h3') {
          children.push(new Paragraph({
            children: [new TextRun({
              text: block.text,
              font: 'Georgia',
              size: 26,
              color: '4D4D4D',
              bold: true,
              italics: true,
            })],
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 280, after: 120 },
          }));
        } else if (block.type === 'bullet') {
          children.push(new Paragraph({
            children: this._renderInlineRuns(block.text, { font: 'Calibri', size: 22 }),
            bullet: { level: block.level || 0 },
            spacing: { before: 40, after: 40 },
          }));
        } else if (block.type === 'numbered') {
          children.push(new Paragraph({
            children: this._renderInlineRuns(block.text, { font: 'Calibri', size: 22 }),
            numbering: { reference: 'default-numbering', level: block.level || 0 },
            spacing: { before: 40, after: 40 },
          }));
        } else if (block.type === 'blockquote') {
          children.push(new Paragraph({
            children: this._renderInlineRuns(block.text, {
              font: 'Georgia',
              size: 22,
              color: '666666',
              italics: true,
            }),
            indent: { left: 720 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 6, color: 'C9A227', space: 8 },
            },
            spacing: { before: 120, after: 120 },
          }));
        } else if (block.type === 'hr') {
          children.push(new Paragraph({
            children: [new TextRun({ text: '', font: 'Calibri' })],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC', space: 1 },
            },
            spacing: { before: 240, after: 240 },
          }));
        } else {
          // Regular paragraph
          const runs = this._renderInlineRuns(block.text, { font: 'Calibri', size: 22 });
          if (runs.length > 0) {
            children.push(new Paragraph({
              children: runs,
              spacing: { before: 80, after: 120, line: 360 },
            }));
          }
        }
      }

      // Footer with provenance note
      const footerParagraph = new Paragraph({
        children: [new TextRun({
          text: 'Generated by The Threshing Floor — Built using Latent Dialogic Space',
          font: 'Calibri',
          size: 16,
          color: '999999',
          italics: true,
        })],
        alignment: AlignmentType.CENTER,
      });

      const doc = new Document({
        numbering: {
          config: [{
            reference: 'default-numbering',
            levels: [{
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            }],
          }],
        },
        sections: [{
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          footers: {
            default: new Footer({ children: [footerParagraph] }),
          },
          children,
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.toast(`Report saved as ${filename}`, 'success');
    } catch (err) {
      console.error('DOCX generation failed:', err);
      this.toast('DOCX generation failed. Falling back to Markdown.', 'warning');
      this.downloadReport();
    }
  },

  /**
   * Parse Markdown text into an array of block objects.
   * Each block: { type: 'h1'|'h2'|'h3'|'paragraph'|'bullet'|'numbered'|'blockquote'|'hr', text: string }
   */
  _parseMarkdownBlocks(md) {
    const lines = md.split('\n');
    const blocks = [];
    let currentParagraph = [];

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const text = currentParagraph.join(' ').trim();
        if (text) blocks.push({ type: 'paragraph', text });
        currentParagraph = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Empty line = paragraph break
      if (trimmed === '') {
        flushParagraph();
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushParagraph();
        blocks.push({ type: 'hr' });
        continue;
      }

      // Headings
      const h1Match = trimmed.match(/^#\s+(.+)/);
      if (h1Match) {
        flushParagraph();
        blocks.push({ type: 'h1', text: h1Match[1].replace(/\*\*/g, '') });
        continue;
      }

      const h2Match = trimmed.match(/^##\s+(.+)/);
      if (h2Match) {
        flushParagraph();
        blocks.push({ type: 'h2', text: h2Match[1].replace(/\*\*/g, '') });
        continue;
      }

      const h3Match = trimmed.match(/^###\s+(.+)/);
      if (h3Match) {
        flushParagraph();
        blocks.push({ type: 'h3', text: h3Match[1].replace(/\*\*/g, '') });
        continue;
      }

      // Blockquote
      const bqMatch = trimmed.match(/^>\s?(.*)/);
      if (bqMatch) {
        flushParagraph();
        blocks.push({ type: 'blockquote', text: bqMatch[1] });
        continue;
      }

      // Bullet list (-, *, +)
      const bulletMatch = trimmed.match(/^[-*+]\s+(.*)/);
      if (bulletMatch) {
        flushParagraph();
        const indent = line.search(/\S/);
        blocks.push({ type: 'bullet', text: bulletMatch[1], level: indent >= 4 ? 1 : 0 });
        continue;
      }

      // Numbered list
      const numMatch = trimmed.match(/^\d+[.)]\s+(.*)/);
      if (numMatch) {
        flushParagraph();
        blocks.push({ type: 'numbered', text: numMatch[1] });
        continue;
      }

      // Regular text — accumulate into paragraph
      currentParagraph.push(trimmed);
    }

    flushParagraph();
    return blocks;
  },

  /**
   * Parse inline Markdown formatting (**bold**, *italic*, `code`) into TextRun objects.
   */
  _renderInlineRuns(text, defaults = {}) {
    const { font = 'Calibri', size = 22, color, italics: defaultItalics } = defaults;
    const runs = [];

    // Regex to match **bold**, *italic*, `code`, and plain text
    const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match[2]) {
        // **bold**
        runs.push(new docx.TextRun({
          text: match[2],
          font,
          size,
          bold: true,
          color: color || '2D2D2D',
          italics: defaultItalics || false,
        }));
      } else if (match[3]) {
        // *italic*
        runs.push(new docx.TextRun({
          text: match[3],
          font,
          size,
          italics: true,
          color: color || '555555',
        }));
      } else if (match[4]) {
        // `code`
        runs.push(new docx.TextRun({
          text: match[4],
          font: 'Courier New',
          size: size - 2,
          color: '8B7121',
          shading: { type: docx.ShadingType.SOLID, color: 'F5F0E0', fill: 'F5F0E0' },
        }));
      } else if (match[5]) {
        // Plain text
        runs.push(new docx.TextRun({
          text: match[5],
          font,
          size,
          color: color || '333333',
          italics: defaultItalics || false,
        }));
      }
    }

    return runs;
  },

  copyReport() {
    if (!this._lastReport) {
      this.toast('No report to copy yet.', 'warning');
      return;
    }

    navigator.clipboard.writeText(this._lastReport).then(() => {
      this.toast('Report copied to clipboard.', 'success');
    }).catch(() => {
      this.toast('Could not copy. Try selecting the text manually.', 'warning');
    });
  },

  // --- Rate Limit Sentinel ---

  _initRateSentinel() {
    // Update UI with current state
    this._updateRateSentinel(RateLimiter.getStatus());

    // Listen for changes
    RateLimiter.onChange((status) => this._updateRateSentinel(status));
  },

  _updateRateSentinel(status) {
    const fill = document.getElementById('rate-gauge-fill');
    const remaining = document.getElementById('rate-remaining');
    const blockedMsg = document.getElementById('rate-blocked-msg');
    const countdown = document.getElementById('rate-countdown');

    if (!fill || !remaining) return;

    // Update gauge width and color
    fill.style.width = `${status.percent}%`;
    fill.classList.remove('low', 'critical');
    if (status.percent <= 10) {
      fill.classList.add('critical');
    } else if (status.percent <= 30) {
      fill.classList.add('low');
    }

    remaining.textContent = status.remaining;

    // Handle blocked state with countdown
    if (status.blocked && blockedMsg && countdown) {
      blockedMsg.style.display = 'block';
      countdown.textContent = `Cooldown: ${status.blockSecondsLeft}s`;

      // Start countdown timer if not already running
      if (!this._countdownInterval) {
        this._countdownInterval = setInterval(() => {
          const s = RateLimiter.getStatus();
          if (!s.blocked) {
            blockedMsg.style.display = 'none';
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
            this._updateRateSentinel(s);

            // Re-enable the thresh button
            const submitBtn = document.getElementById('thresh-submit');
            if (submitBtn) submitBtn.disabled = false;
          } else {
            countdown.textContent = `Cooldown: ${s.blockSecondsLeft}s`;
          }
        }, 1000);
      }
    } else if (blockedMsg) {
      blockedMsg.style.display = 'none';
    }
  },

  // --- Toast Notifications ---

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-message">${this._escapeHtml(message)}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // --- Persistence ---

  _saveCollections() {
    try {
      // Only save essential data (posts can be large)
      const toSave = this.collections.map(c => ({
        id: c.id,
        posts: c.posts,
        comments: c.comments || [],
        config: c.config,
        timestamp: c.timestamp,
      }));
      localStorage.setItem('thresh_collections', JSON.stringify(toSave));
    } catch (e) {
      // localStorage might be full
      if (e.name === 'QuotaExceededError') {
        this.toast('Storage full. Older collections may be removed.', 'warning');
        // Remove oldest collection and try again
        if (this.collections.length > 1) {
          this.collections.shift();
          this._saveCollections();
        }
      }
    }
  },

  _loadCollections() {
    try {
      const saved = localStorage.getItem('thresh_collections');
      if (saved) {
        this.collections = JSON.parse(saved);
      }
    } catch {
      this.collections = [];
    }
  },

  // --- UI Helpers ---

  _populateCollectionSelect(select) {
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select a collection...</option>';

    this.collections.forEach(c => {
      const date = new Date(c.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const label = `r/${c.config.subreddit} — ${c.posts.length} posts (${date})`;
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = label;
      select.appendChild(opt);
    });

    if (currentVal) select.value = currentVal;
  },

  _updateSelectors() {
    ['harvest-collection', 'glean-collection', 'winnow-collection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) this._populateCollectionSelect(el);
    });
  },

  _updateFloorRecent() {
    const el = document.getElementById('floor-recent');
    if (!el) return;

    if (this.collections.length === 0) {
      el.innerHTML = '<p class="text-ash text-sm">No collections yet. Start by threshing a subreddit.</p>';
      return;
    }

    const recent = this.collections.slice(-5).reverse();
    el.innerHTML = recent.map(c => {
      const date = new Date(c.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--smoke);">
          <div>
            <span class="text-bone text-sm" style="font-weight:500;">r/${this._escapeHtml(c.config.subreddit)}</span>
            <span class="text-ash text-xs">&middot; ${c.posts.length} posts &middot; ${c.config.sort}</span>
          </div>
          <span class="text-ash text-xs">${date}</span>
        </div>
      `;
    }).join('');
  },

  _dateRange(posts) {
    if (!posts.length) return 'N/A';
    const dates = posts.map(p => p.created_utc).sort();
    const earliest = new Date(dates[0] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const latest = new Date(dates[dates.length - 1] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return earliest === latest ? earliest : `${earliest} — ${latest}`;
  },

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// --- Boot ---
window.ThreshApp = ThreshApp;
document.addEventListener('DOMContentLoaded', () => ThreshApp.init());
