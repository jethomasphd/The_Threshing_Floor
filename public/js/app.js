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
  wordFreqChart: null,

  // --- Initialization ---

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

    // Restore intro-seen state
    if (localStorage.getItem('thresh_intro_seen')) {
      this.enterApp(true);
    }
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

    localStorage.setItem('thresh_intro_seen', '1');

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
      this.toast(`Collection failed: ${err.message}`, 'error');
      progressEl.style.display = 'none';
      submitBtn.disabled = false;
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
      this._renderWordFreqChart();
    }
  },

  async runAnalysis() {
    const id = document.getElementById('winnow-collection').value;
    const collection = this.collections.find(c => c.id === id);
    if (!collection) {
      this.toast('Select a collection first.', 'warning');
      return;
    }

    if (!ClaudeClient.hasKey()) {
      this.showClaudeKeyModal();
      return;
    }

    const analysisType = document.getElementById('winnow-prompt').value;
    const customPrompt = document.getElementById('winnow-custom').value;
    const statusEl = document.getElementById('winnow-status');

    statusEl.textContent = 'Analyzing...';

    try {
      const result = await ClaudeClient.analyze(collection.posts, analysisType, customPrompt);

      document.getElementById('winnow-response').textContent = result;
      document.getElementById('winnow-result').style.display = 'block';
      statusEl.textContent = '';
      this.toast('Analysis complete!', 'success');
    } catch (err) {
      statusEl.textContent = '';
      this.toast(`Analysis failed: ${err.message}`, 'error');
    }
  },

  _renderWordFreqChart() {
    if (!this.activeCollection) return;

    const canvas = document.getElementById('word-freq-chart');
    if (!canvas) return;

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

    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    // Destroy previous chart
    if (this.wordFreqChart) {
      this.wordFreqChart.destroy();
    }

    this.wordFreqChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(s => s[0]),
        datasets: [{
          label: 'Frequency',
          data: sorted.map(s => s[1]),
          backgroundColor: 'rgba(201, 162, 39, 0.6)',
          borderColor: 'rgba(201, 162, 39, 1)',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: '#A8A49C' },
            grid: { color: 'rgba(61, 61, 74, 0.5)' },
          },
          y: {
            ticks: { color: '#E8E4DC', font: { family: "'IBM Plex Mono', monospace", size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  },

  // --- Claude Key Modal ---

  showClaudeKeyModal() {
    const modal = document.getElementById('claude-modal');
    const input = document.getElementById('claude-api-key');
    input.value = ClaudeClient.getKey();
    modal.classList.add('visible');
  },

  hideClaudeKeyModal() {
    document.getElementById('claude-modal').classList.remove('visible');
  },

  saveClaudeKey() {
    const key = document.getElementById('claude-api-key').value.trim();
    ClaudeClient.saveKey(key);
    this.hideClaudeKeyModal();
    this.toast(key ? 'API key saved.' : 'API key removed.', 'success');
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
