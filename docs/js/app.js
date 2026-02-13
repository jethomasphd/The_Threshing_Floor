/**
 * Main application — routing, page rendering, event handling.
 */
'use strict';

window.Thresh = window.Thresh || {};

Thresh.App = (function () {
  let $content;

  /* ============================================
     Sigil SVG (reusable)
     ============================================ */
  function sigil(size) {
    size = size || 48;
    return '<svg class="sigil" viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<line x1="14" y1="38" x2="24" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="34" y1="38" x2="24" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="10" y1="28" x2="38" y2="28" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '<line x1="12" y1="33" x2="36" y2="33" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* ============================================
     Toast Notifications
     ============================================ */
  function toast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { container.removeChild(el); }, 300);
    }, 4000);
  }

  /* ============================================
     Rate Limit Sentinel
     ============================================ */
  function updateSentinel() {
    if (!Thresh.Reddit.isConnected()) {
      document.getElementById('sentinel-label').textContent = 'Not connected';
      document.getElementById('sentinel-fill').style.width = '0%';
      return;
    }
    var s = Thresh.Reddit.getRateLimit();
    var fill = document.getElementById('sentinel-fill');
    fill.style.width = s.pct + '%';
    fill.className = 'sentinel-fill' + (s.pct < 20 ? ' depleted' : s.pct < 40 ? ' low' : '');
    document.getElementById('sentinel-label').textContent = s.remaining + ' requests remaining';
  }

  /* ============================================
     Router
     ============================================ */
  function getRoute() {
    var hash = window.location.hash.replace('#', '') || '/';
    if (hash === '/') return 'floor';
    return hash.replace('/', '');
  }

  function navigate(page) {
    window.location.hash = '#/' + (page === 'floor' ? '' : page);
  }

  function onRouteChange() {
    var page = getRoute();
    renderPage(page);

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(function (link) {
      var p = link.getAttribute('data-page');
      link.classList.toggle('active', p === page);
    });

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
  }

  /* ============================================
     Page Renderers
     ============================================ */
  function renderPage(page) {
    var renderers = {
      floor: renderFloor,
      explore: renderExplore,
      thresh: renderThresh,
      harvest: renderHarvest,
      winnow: renderWinnow,
      glean: renderGlean,
      about: renderAbout,
    };
    var fn = renderers[page];
    if (fn) {
      fn();
    } else {
      $content.innerHTML = '<div class="page-header"><h1 class="text-ember">Not Found</h1></div>';
    }
    updateSentinel();
  }

  /* ---------- FLOOR (Dashboard) ---------- */
  async function renderFloor() {
    var stats = await Thresh.Storage.getStats();
    var collections = await Thresh.Storage.getCollections();
    var recent = collections.slice(0, 5);

    var recentHtml = '';
    if (recent.length === 0) {
      recentHtml = '<div class="empty-state">' +
        '<div class="sigil-large">' + sigil(64) + '</div>' +
        '<h2>No collections yet</h2>' +
        '<p>Start by exploring subreddits and collecting your first dataset.</p>' +
        '<button class="btn btn-primary" onclick="Thresh.App.navigate(\'explore\')">Explore Subreddits</button>' +
        '</div>';
    } else {
      recentHtml = recent.map(function (c) {
        return '<div class="collection-item">' +
          '<div class="ci-info">' +
            '<div class="ci-name">r/' + esc(c.subreddit) + (c.query ? ' &mdash; "' + esc(c.query) + '"' : '') + '</div>' +
            '<div class="ci-meta">' + esc(c.postCount || 0) + ' posts &middot; ' + formatDate(c.createdAt) + '</div>' +
          '</div>' +
          '<span class="ci-status ' + (c.status || 'completed') + '">' + esc(c.status || 'completed') + '</span>' +
        '</div>';
      }).join('');
    }

    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>The Floor</h1>' +
        '<p class="subtitle">Your workspace. Recent activity and quick actions.</p>' +
      '</div>' +
      '<div class="stats-grid">' +
        statCard(stats.collections, 'Collections') +
        statCard(stats.posts, 'Posts Collected') +
        statCard(stats.comments, 'Comments') +
        statCard(stats.exports, 'Exports') +
      '</div>' +
      (Thresh.Reddit.isConnected() ? '' : connectPrompt()) +
      '<h2 class="mb-2">Recent Collections</h2>' +
      recentHtml;
  }

  function statCard(value, label) {
    return '<div class="stat-card">' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-label">' + label + '</div>' +
    '</div>';
  }

  function connectPrompt() {
    return '<div class="card mb-3" style="border-left: 3px solid var(--warning);">' +
      '<p class="mb-1" style="color:var(--warning);font-weight:500;">Reddit API not connected</p>' +
      '<p class="text-bone-muted" style="font-size:0.875rem;">Connect your Reddit account to search subreddits and collect data. ' +
        '<a href="#/about" style="color:var(--ember);">Setup guide &rarr;</a></p>' +
    '</div>';
  }

  /* ---------- EXPLORE ---------- */
  function renderExplore() {
    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>Explore</h1>' +
        '<p class="subtitle">Scout the field. Discover subreddits before you harvest.</p>' +
      '</div>' +
      (Thresh.Reddit.isConnected() ?
        '<div class="flex gap-2 mb-3">' +
          '<input id="explore-query" class="form-input" style="max-width:400px;" placeholder="Search subreddits..." ' +
            'onkeydown="if(event.key===\'Enter\')Thresh.App.doExploreSearch()">' +
          '<button class="btn btn-primary" onclick="Thresh.App.doExploreSearch()">Search</button>' +
        '</div>' +
        '<div id="explore-results"></div>'
        : setupCard()
      );
  }

  async function doExploreSearch() {
    var query = document.getElementById('explore-query').value.trim();
    if (!query) return;
    var results = document.getElementById('explore-results');
    results.innerHTML = loadingHTML('Searching subreddits...');

    try {
      var subs = await Thresh.Reddit.searchSubreddits(query, 12);
      updateSentinel();
      if (subs.length === 0) {
        results.innerHTML = '<p class="text-ash">No subreddits found for "' + esc(query) + '".</p>';
        return;
      }
      results.innerHTML = '<div class="subreddit-grid">' + subs.map(function (s) {
        return '<div class="subreddit-card">' +
          '<div class="sr-name">r/' + esc(s.name) + '</div>' +
          '<div class="sr-subscribers">' + formatNumber(s.subscribers) + ' members</div>' +
          '<div class="sr-desc">' + esc(s.description || 'No description.') + '</div>' +
          '<div class="sr-actions">' +
            '<button class="btn btn-primary btn-sm" onclick="Thresh.App.navigateToThresh(\'' + esc(s.name) + '\')">Collect</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    } catch (e) {
      results.innerHTML = '<p class="text-error">' + esc(e.message) + '</p>';
      updateSentinel();
    }
  }

  function navigateToThresh(subreddit) {
    navigate('thresh');
    // After render, pre-fill the subreddit
    setTimeout(function () {
      var inp = document.getElementById('thresh-subreddit');
      if (inp) inp.value = subreddit;
    }, 50);
  }

  /* ---------- THRESH (Collection) ---------- */
  async function renderThresh() {
    var collections = await Thresh.Storage.getCollections();
    var historyHtml = collections.slice(0, 10).map(function (c) {
      return '<div class="collection-item">' +
        '<div class="ci-info">' +
          '<div class="ci-name">r/' + esc(c.subreddit) + (c.query ? ' &mdash; "' + esc(c.query) + '"' : '') + '</div>' +
          '<div class="ci-meta">' + esc(c.postCount || 0) + ' posts &middot; ' + formatDate(c.createdAt) + '</div>' +
        '</div>' +
        '<span class="ci-status ' + (c.status || 'completed') + '">' + esc(c.status || 'completed') + '</span>' +
      '</div>';
    }).join('') || '<p class="text-ash">No collections yet.</p>';

    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>Thresh</h1>' +
        '<p class="subtitle">Beat the grain. Configure and run a collection.</p>' +
      '</div>' +
      (Thresh.Reddit.isConnected() ?
        '<div class="card mb-3" style="max-width:560px;">' +
          '<div class="form-group">' +
            '<label class="form-label" for="thresh-subreddit">Subreddit</label>' +
            '<input id="thresh-subreddit" class="form-input" placeholder="e.g., mentalhealth">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="thresh-sort">Sort by</label>' +
            '<select id="thresh-sort" class="form-select" onchange="Thresh.App.onSortChange()">' +
              '<option value="hot">Hot</option>' +
              '<option value="new">New</option>' +
              '<option value="top">Top</option>' +
              '<option value="rising">Rising</option>' +
              '<option value="controversial">Controversial</option>' +
            '</select>' +
          '</div>' +
          '<div class="form-group hidden" id="thresh-time-group">' +
            '<label class="form-label" for="thresh-time">Time filter</label>' +
            '<select id="thresh-time" class="form-select">' +
              '<option value="day">Past 24 hours</option>' +
              '<option value="week">Past week</option>' +
              '<option value="month">Past month</option>' +
              '<option value="year">Past year</option>' +
              '<option value="all">All time</option>' +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Limit: <span id="thresh-limit-val">25</span> posts</label>' +
            '<input id="thresh-limit" class="form-range" type="range" min="10" max="100" step="5" value="25" ' +
              'oninput="document.getElementById(\'thresh-limit-val\').textContent=this.value">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="thresh-keyword">Keyword filter (optional)</label>' +
            '<input id="thresh-keyword" class="form-input" placeholder="Only posts containing...">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-check"><input type="checkbox" id="thresh-comments"> Include comments (slower)</label>' +
          '</div>' +
          '<button class="btn btn-primary" id="thresh-go" onclick="Thresh.App.doCollection()">Begin Collection</button>' +
          '<div id="thresh-progress" class="mt-2"></div>' +
        '</div>'
        : setupCard()
      ) +
      '<hr class="section-divider mt-3 mb-3">' +
      '<h2 class="mb-2">Previous Collections</h2>' +
      historyHtml;
  }

  function onSortChange() {
    var sort = document.getElementById('thresh-sort').value;
    var tg = document.getElementById('thresh-time-group');
    if (sort === 'top' || sort === 'controversial') {
      tg.classList.remove('hidden');
    } else {
      tg.classList.add('hidden');
    }
  }

  async function doCollection() {
    var subreddit = document.getElementById('thresh-subreddit').value.trim();
    if (!subreddit) { toast('Enter a subreddit name.', 'warning'); return; }

    var sort = document.getElementById('thresh-sort').value;
    var time = document.getElementById('thresh-time') ? document.getElementById('thresh-time').value : null;
    var limit = parseInt(document.getElementById('thresh-limit').value, 10);
    var keyword = document.getElementById('thresh-keyword').value.trim() || null;
    var includeComments = document.getElementById('thresh-comments').checked;

    var btn = document.getElementById('thresh-go');
    var prog = document.getElementById('thresh-progress');
    btn.disabled = true;
    btn.textContent = 'Collecting...';
    prog.innerHTML = '<div class="progress-bar"><div class="progress-fill" id="thresh-bar" style="width:10%"></div></div>' +
      '<p class="text-ash" id="thresh-status">Fetching posts from r/' + esc(subreddit) + '...</p>';

    try {
      var posts = await Thresh.Reddit.getPosts(subreddit, sort, time, limit, keyword);
      updateSentinel();

      document.getElementById('thresh-bar').style.width = '60%';
      document.getElementById('thresh-status').textContent = 'Got ' + posts.length + ' posts.';

      var comments = null;
      var commentCount = 0;
      if (includeComments && posts.length > 0) {
        comments = {};
        var maxCommentPosts = Math.min(posts.length, 20); // Limit to avoid rate limit
        for (var i = 0; i < maxCommentPosts; i++) {
          document.getElementById('thresh-status').textContent =
            'Fetching comments (' + (i + 1) + '/' + maxCommentPosts + ')...';
          document.getElementById('thresh-bar').style.width = (60 + (i / maxCommentPosts) * 35) + '%';
          try {
            var cmts = await Thresh.Reddit.getComments(posts[i].id, subreddit, 3, 50);
            comments[posts[i].id] = cmts;
            commentCount += cmts.length;
            updateSentinel();
            // Small delay between requests
            await new Promise(function (r) { setTimeout(r, 200); });
          } catch (_e) {
            // Skip failed comment fetches
          }
        }
      }

      var collection = {
        subreddit: subreddit,
        query: keyword,
        sort: sort,
        timeFilter: time,
        limit: limit,
        posts: posts,
        comments: comments,
        postCount: posts.length,
        commentCount: commentCount,
        createdAt: new Date().toISOString(),
        status: 'completed',
      };

      await Thresh.Storage.saveCollection(collection);

      document.getElementById('thresh-bar').style.width = '100%';
      document.getElementById('thresh-status').textContent = 'Done! Collected ' + posts.length + ' posts' +
        (commentCount > 0 ? ' and ' + commentCount + ' comments.' : '.');
      toast('Collection complete: ' + posts.length + ' posts from r/' + subreddit, 'success');

      btn.textContent = 'Begin Collection';
      btn.disabled = false;
    } catch (e) {
      prog.innerHTML = '<p class="text-error">' + esc(e.message) + '</p>';
      toast(e.message, 'error');
      btn.textContent = 'Begin Collection';
      btn.disabled = false;
      updateSentinel();
    }
  }

  /* ---------- HARVEST (View Results) ---------- */
  async function renderHarvest() {
    var collections = await Thresh.Storage.getCollections();

    var optionsHtml = collections.map(function (c) {
      return '<option value="' + c.id + '">r/' + esc(c.subreddit) +
        ' (' + (c.postCount || 0) + ' posts, ' + formatDate(c.createdAt) + ')</option>';
    }).join('');

    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>Harvest</h1>' +
        '<p class="subtitle">Gather what was threshed. View and filter your collected data.</p>' +
      '</div>' +
      (collections.length === 0
        ? '<div class="empty-state">' +
            '<div class="sigil-large">' + sigil(64) + '</div>' +
            '<h2>Nothing to harvest yet</h2>' +
            '<p>Collect some data first, then come back to view it.</p>' +
            '<button class="btn btn-primary" onclick="Thresh.App.navigate(\'thresh\')">Start Collection</button>' +
          '</div>'
        : '<div class="flex gap-2 items-center mb-3">' +
            '<select id="harvest-select" class="form-select" style="max-width:400px;" onchange="Thresh.App.loadHarvest()">' +
              '<option value="">Select a collection...</option>' + optionsHtml +
            '</select>' +
            '<button class="btn btn-danger btn-sm" onclick="Thresh.App.deleteHarvestCollection()" title="Delete this collection">Delete</button>' +
          '</div>' +
          '<div class="flex gap-2 mb-2">' +
            '<input id="harvest-filter" class="form-input" style="max-width:250px;" placeholder="Filter by keyword..." oninput="Thresh.App.filterHarvest()">' +
            '<input id="harvest-min-score" class="form-input" style="max-width:120px;" type="number" placeholder="Min score" oninput="Thresh.App.filterHarvest()">' +
          '</div>' +
          '<div id="harvest-table"></div>'
      );
  }

  var harvestData = null;

  async function loadHarvest() {
    var id = document.getElementById('harvest-select').value;
    if (!id) { document.getElementById('harvest-table').innerHTML = ''; harvestData = null; return; }

    var collection = await Thresh.Storage.getCollection(id);
    if (!collection) { document.getElementById('harvest-table').innerHTML = '<p class="text-error">Collection not found.</p>'; return; }
    harvestData = collection;
    renderHarvestTable(collection.posts);
  }

  function filterHarvest() {
    if (!harvestData) return;
    var kw = (document.getElementById('harvest-filter').value || '').toLowerCase();
    var min = parseInt(document.getElementById('harvest-min-score').value, 10) || 0;
    var filtered = harvestData.posts.filter(function (p) {
      if (p.score < min) return false;
      if (kw && !(p.title || '').toLowerCase().includes(kw) && !(p.selftext || '').toLowerCase().includes(kw)) return false;
      return true;
    });
    renderHarvestTable(filtered);
  }

  function renderHarvestTable(posts) {
    var out = document.getElementById('harvest-table');
    if (posts.length === 0) {
      out.innerHTML = '<p class="text-ash mt-2">No posts match your filters.</p>';
      return;
    }

    var rows = posts.map(function (p) {
      return '<tr>' +
        '<td title="' + esc(p.title) + '">' + esc(truncate(p.title, 60)) + '</td>' +
        '<td>' + esc(p.author) + '</td>' +
        '<td>' + p.score + '</td>' +
        '<td>' + p.numComments + '</td>' +
        '<td>' + formatDate(new Date(p.created * 1000).toISOString()) + '</td>' +
        '<td><a href="' + esc(p.permalink) + '" target="_blank" rel="noopener" style="color:var(--link);">view</a></td>' +
      '</tr>';
    }).join('');

    out.innerHTML = '<p class="text-ash mb-1">' + posts.length + ' posts</p>' +
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>Title</th><th>Author</th><th>Score</th><th>Comments</th><th>Date</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  async function deleteHarvestCollection() {
    var id = document.getElementById('harvest-select').value;
    if (!id) return;
    if (!confirm('Delete this collection? This cannot be undone.')) return;
    await Thresh.Storage.deleteCollection(id);
    toast('Collection deleted.', 'info');
    renderHarvest();
  }

  /* ---------- WINNOW (Analysis) ---------- */
  async function renderWinnow() {
    var collections = await Thresh.Storage.getCollections();

    var optionsHtml = collections.map(function (c) {
      return '<option value="' + c.id + '">r/' + esc(c.subreddit) +
        ' (' + (c.postCount || 0) + ' posts)</option>';
    }).join('');

    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>Winnow</h1>' +
        '<p class="subtitle">The wind that carries away chaff. Analyze patterns in your data.</p>' +
      '</div>' +
      (collections.length === 0
        ? '<div class="empty-state">' +
            '<div class="sigil-large">' + sigil(64) + '</div>' +
            '<h2>Nothing to winnow</h2>' +
            '<p>Collect data first, then analyze it here.</p>' +
          '</div>'
        : '<div class="mb-3">' +
            '<select id="winnow-select" class="form-select" style="max-width:400px;" onchange="Thresh.App.loadWinnow()">' +
              '<option value="">Select a collection...</option>' + optionsHtml +
            '</select>' +
          '</div>' +
          '<div id="winnow-charts"></div>'
      );
  }

  async function loadWinnow() {
    var id = document.getElementById('winnow-select').value;
    var container = document.getElementById('winnow-charts');
    if (!id) { container.innerHTML = ''; return; }

    var collection = await Thresh.Storage.getCollection(id);
    if (!collection || !collection.posts.length) {
      container.innerHTML = '<p class="text-ash">No data to analyze.</p>';
      return;
    }

    var posts = collection.posts;

    // Score distribution
    var scores = posts.map(function (p) { return p.score; }).sort(function (a, b) { return a - b; });
    var avgScore = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
    var medianScore = scores[Math.floor(scores.length / 2)];

    // Top authors
    var authorCounts = {};
    posts.forEach(function (p) {
      if (p.author && p.author !== '[deleted]') {
        authorCounts[p.author] = (authorCounts[p.author] || 0) + 1;
      }
    });
    var topAuthors = Object.entries(authorCounts)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 10);

    // Word frequency (titles)
    var wordCounts = {};
    var stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'was', 'are', 'be', 'has', 'had',
      'have', 'do', 'did', 'not', 'my', 'me', 'i', 'you', 'we', 'they', 'he', 'she', 'its',
      'what', 'how', 'so', 'if', 'just', 'about', 'can', 'will', 'would', 'all', 'been', 'up',
      'out', 'no', 'like', 'get', 'when', 'your', 'more', 'any', 'some', 'than', 'very', 'as']);
    posts.forEach(function (p) {
      (p.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).forEach(function (w) {
        if (w.length > 2 && !stopWords.has(w)) {
          wordCounts[w] = (wordCounts[w] || 0) + 1;
        }
      });
    });
    var topWords = Object.entries(wordCounts)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 15);

    // Posts over time
    var timeBuckets = {};
    posts.forEach(function (p) {
      var d = new Date(p.created * 1000).toISOString().slice(0, 10);
      timeBuckets[d] = (timeBuckets[d] || 0) + 1;
    });
    var timeLabels = Object.keys(timeBuckets).sort();
    var timeCounts = timeLabels.map(function (l) { return timeBuckets[l]; });

    container.innerHTML =
      '<div class="stats-grid mb-3">' +
        statCard(posts.length, 'Posts') +
        statCard(avgScore, 'Avg Score') +
        statCard(medianScore, 'Median Score') +
        statCard(Object.keys(authorCounts).length, 'Unique Authors') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">' +
        '<div class="chart-container">' +
          '<h3>Word Frequency (Titles)</h3>' +
          '<div class="chart-wrap"><canvas id="chart-words"></canvas></div>' +
        '</div>' +
        '<div class="chart-container">' +
          '<h3>Posts Over Time</h3>' +
          '<div class="chart-wrap"><canvas id="chart-time"></canvas></div>' +
        '</div>' +
        '<div class="chart-container">' +
          '<h3>Top Authors</h3>' +
          '<div class="chart-wrap"><canvas id="chart-authors"></canvas></div>' +
        '</div>' +
        '<div class="chart-container">' +
          '<h3>Score Distribution</h3>' +
          '<div class="chart-wrap"><canvas id="chart-scores"></canvas></div>' +
        '</div>' +
      '</div>';

    // Render charts after DOM update
    setTimeout(function () {
      var chartColors = {
        ember: 'rgba(201, 162, 39, 0.8)',
        emberDim: 'rgba(201, 162, 39, 0.3)',
        bone: 'rgba(232, 228, 220, 0.7)',
        ash: 'rgba(107, 107, 123, 0.5)',
      };

      var defaults = Chart.defaults;
      defaults.color = '#A8A49C';
      defaults.borderColor = 'rgba(61, 61, 74, 0.5)';
      defaults.font.family = "'IBM Plex Sans', sans-serif";

      // Word frequency
      new Chart(document.getElementById('chart-words'), {
        type: 'bar',
        data: {
          labels: topWords.map(function (w) { return w[0]; }),
          datasets: [{ label: 'Count', data: topWords.map(function (w) { return w[1]; }),
            backgroundColor: chartColors.ember, borderRadius: 2 }],
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } },
          scales: { x: { grid: { color: 'rgba(61,61,74,0.3)' } }, y: { grid: { display: false } } } },
      });

      // Posts over time
      new Chart(document.getElementById('chart-time'), {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{ label: 'Posts', data: timeCounts,
            borderColor: chartColors.ember, backgroundColor: chartColors.emberDim,
            fill: true, tension: 0.3, pointRadius: 3 }],
        },
        options: { plugins: { legend: { display: false } },
          scales: { x: { grid: { color: 'rgba(61,61,74,0.3)' } }, y: { grid: { color: 'rgba(61,61,74,0.3)' }, beginAtZero: true } } },
      });

      // Top authors
      new Chart(document.getElementById('chart-authors'), {
        type: 'bar',
        data: {
          labels: topAuthors.map(function (a) { return a[0]; }),
          datasets: [{ label: 'Posts', data: topAuthors.map(function (a) { return a[1]; }),
            backgroundColor: chartColors.ember, borderRadius: 2 }],
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } },
          scales: { x: { grid: { color: 'rgba(61,61,74,0.3)' } }, y: { grid: { display: false } } } },
      });

      // Score distribution (histogram)
      var bucketSize = Math.max(1, Math.floor((scores[scores.length - 1] - scores[0]) / 15));
      var histLabels = [];
      var histData = [];
      if (bucketSize > 0) {
        for (var lo = scores[0]; lo <= scores[scores.length - 1]; lo += bucketSize) {
          var hi = lo + bucketSize;
          histLabels.push(lo + '-' + hi);
          histData.push(scores.filter(function (s) { return s >= lo && s < hi; }).length);
        }
      } else {
        histLabels = scores.map(String);
        histData = scores.map(function () { return 1; });
      }

      new Chart(document.getElementById('chart-scores'), {
        type: 'bar',
        data: {
          labels: histLabels,
          datasets: [{ label: 'Posts', data: histData,
            backgroundColor: chartColors.ember, borderRadius: 2 }],
        },
        options: { plugins: { legend: { display: false } },
          scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(61,61,74,0.3)' }, beginAtZero: true } } },
      });
    }, 50);
  }

  /* ---------- GLEAN (Export) ---------- */
  async function renderGlean() {
    var collections = await Thresh.Storage.getCollections();

    var optionsHtml = collections.map(function (c) {
      return '<option value="' + c.id + '">r/' + esc(c.subreddit) +
        ' (' + (c.postCount || 0) + ' posts)</option>';
    }).join('');

    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>Glean</h1>' +
        '<p class="subtitle">Gather cleaned grain into bundles. Export with provenance.</p>' +
      '</div>' +
      (collections.length === 0
        ? '<div class="empty-state">' +
            '<div class="sigil-large">' + sigil(64) + '</div>' +
            '<h2>Nothing to glean</h2>' +
            '<p>Collect data first, then export it here with full provenance.</p>' +
          '</div>'
        : '<div class="card" style="max-width:560px;">' +
          '<div class="form-group">' +
            '<label class="form-label">Collection</label>' +
            '<select id="glean-select" class="form-select" onchange="Thresh.App.previewProvenance()">' +
              '<option value="">Select a collection...</option>' + optionsHtml +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Format</label>' +
            '<select id="glean-format" class="form-select">' +
              '<option value="csv">CSV (UTF-8, Excel-compatible)</option>' +
              '<option value="json">JSON (pretty-printed)</option>' +
              '<option value="jsonl">JSONL (one record per line)</option>' +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-check"><input type="checkbox" id="glean-anonymize" checked> Anonymize usernames</label>' +
            '<p class="form-hint">Replaces usernames with hashed identifiers to reduce re-identification risk.</p>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-check"><input type="checkbox" id="glean-comments"> Include comments</label>' +
          '</div>' +
          '<button class="btn btn-primary" onclick="Thresh.App.doExport()">Export ZIP</button>' +
          '<hr class="section-divider ember mt-3 mb-3">' +
          '<h3 class="mb-1" style="font-size:1rem;color:var(--bone-muted);">Provenance Preview</h3>' +
          '<div id="glean-provenance" class="provenance-preview">Select a collection to preview provenance.</div>' +
        '</div>'
      );
  }

  async function previewProvenance() {
    var id = document.getElementById('glean-select').value;
    var pre = document.getElementById('glean-provenance');
    if (!id) { pre.textContent = 'Select a collection to preview provenance.'; return; }
    var collection = await Thresh.Storage.getCollection(id);
    if (!collection) { pre.textContent = 'Collection not found.'; return; }
    var format = document.getElementById('glean-format').value;
    var anonymize = document.getElementById('glean-anonymize').checked;
    pre.textContent = Thresh.Export.generateProvenance(collection, format, { anonymize: anonymize });
  }

  async function doExport() {
    var id = document.getElementById('glean-select').value;
    if (!id) { toast('Select a collection first.', 'warning'); return; }
    var collection = await Thresh.Storage.getCollection(id);
    if (!collection) { toast('Collection not found.', 'error'); return; }

    var format = document.getElementById('glean-format').value;
    var anonymize = document.getElementById('glean-anonymize').checked;
    var includeComments = document.getElementById('glean-comments').checked;

    try {
      await Thresh.Export.exportCollection(collection, format, {
        anonymize: anonymize,
        includeComments: includeComments,
      });
      toast('Export downloaded!', 'success');
    } catch (e) {
      toast('Export failed: ' + e.message, 'error');
    }
  }

  /* ---------- ABOUT ---------- */
  function renderAbout() {
    var connected = Thresh.Reddit.isConnected();
    var clientId = Thresh.Reddit.getClientId();

    $content.innerHTML =
      '<div class="page-header">' +
        '<h1>About</h1>' +
        '<p class="subtitle">The Threshing Floor &mdash; a counter-technology for attention.</p>' +
      '</div>' +

      '<div class="card mb-3">' +
        '<h2 class="mb-1" style="color:var(--ember);">What This Is</h2>' +
        '<p>Thresh is a local-first tool for collecting, exploring, and exporting Reddit data. ' +
        'It wraps the Reddit API behind an intuitive interface so that anyone &mdash; researcher, journalist, ' +
        'civic technologist, curious citizen &mdash; can go from "I want to understand what people are saying" ' +
        'to "here\'s my cleaned, documented dataset" without writing code.</p>' +
        '<p class="mt-1 text-ash" style="font-size:0.875rem;">Built by Jacob E. Thomas.</p>' +
      '</div>' +

      '<div class="card mb-3" id="setup-section">' +
        '<h2 class="mb-1" style="color:var(--ember);">Reddit API Setup</h2>' +
        (connected
          ? '<p class="text-success mb-1">Connected to Reddit.</p>' +
            '<p class="text-bone-muted" style="font-size:0.875rem;">Your session is active. Tokens expire after 1 hour.</p>' +
            '<button class="btn btn-secondary btn-sm mt-1" onclick="Thresh.App.disconnectReddit()">Disconnect</button>'
          : '<p class="text-bone-muted mb-2">To search subreddits and collect data, connect a Reddit API app. This takes about 30 seconds.</p>' +
            '<div class="setup-step"><span class="setup-step-num">1</span>' +
              '<div class="setup-step-content">Go to <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener">reddit.com/prefs/apps</a> and click <strong>"create another app"</strong></div></div>' +
            '<div class="setup-step"><span class="setup-step-num">2</span>' +
              '<div class="setup-step-content">Choose <strong>"web app"</strong>. Set the redirect URI to:<br>' +
              '<code id="redirect-uri">' + esc(window.location.origin + window.location.pathname) + '</code></div></div>' +
            '<div class="setup-step"><span class="setup-step-num">3</span>' +
              '<div class="setup-step-content">Copy the <strong>client ID</strong> (the string under your app name) and paste it below.</div></div>' +
            '<div class="form-group mt-2">' +
              '<label class="form-label" for="setup-client-id">Client ID</label>' +
              '<input id="setup-client-id" class="form-input" style="max-width:360px;" placeholder="Paste your client ID..." value="' + esc(clientId) + '">' +
            '</div>' +
            '<button class="btn btn-primary" onclick="Thresh.App.connectReddit()">Connect to Reddit</button>'
        ) +
      '</div>' +

      '<div class="card mb-3">' +
        '<h2 class="mb-1" style="color:var(--ember);">Ethics & Privacy</h2>' +
        '<ul style="padding-left:1.25rem;color:var(--bone-muted);line-height:2;">' +
          '<li>All data stays in your browser. Nothing is sent to any server except Reddit\'s API.</li>' +
          '<li>Default exports anonymize usernames to reduce re-identification risk.</li>' +
          '<li>Reddit data is public, but context matters. Consider IRB review for research.</li>' +
          '<li>Respect <a href="https://www.reddit.com/wiki/api" target="_blank" rel="noopener">Reddit\'s API Terms</a>.</li>' +
          '<li>OAuth tokens are stored in your browser and expire after 1 hour.</li>' +
        '</ul>' +
      '</div>' +

      '<div class="card mb-3">' +
        '<h2 class="mb-1" style="color:var(--ember);">Citation</h2>' +
        '<p class="text-bone-muted">If using this tool in published work:</p>' +
        '<div class="provenance-preview mt-1" style="max-height:none;">Data collected via The Threshing Floor v0.1.0\nhttps://github.com/jethomasphd/The_Threshing_Floor</div>' +
      '</div>';
  }

  function connectReddit() {
    var clientId = document.getElementById('setup-client-id').value.trim();
    if (!clientId) { toast('Enter your Reddit client ID.', 'warning'); return; }
    Thresh.Reddit.setClientId(clientId);
    try {
      Thresh.Reddit.authorize();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function disconnectReddit() {
    Thresh.Reddit.clearToken();
    toast('Disconnected from Reddit.', 'info');
    renderAbout();
    updateSentinel();
  }

  /* ---------- Setup Card (shared) ---------- */
  function setupCard() {
    return '<div class="setup-card">' +
      '<h2>Connect to Reddit</h2>' +
      '<p class="text-bone-muted mb-2">This feature requires a Reddit API connection. It takes about 30 seconds to set up.</p>' +
      '<button class="btn btn-primary" onclick="Thresh.App.navigate(\'about\')">Setup Guide</button>' +
    '</div>';
  }

  /* ---------- Utility ---------- */
  function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_e) {
      return iso;
    }
  }

  function loadingHTML(msg) {
    return '<div class="loading-sigil">' + sigil(48) + '<span>' + esc(msg || 'Loading...') + '</span></div>';
  }

  /* ============================================
     Init
     ============================================ */
  async function init() {
    $content = document.getElementById('page-content');

    // Handle OAuth callback (if returning from Reddit auth)
    if (Thresh.Reddit.handleCallback()) {
      toast('Connected to Reddit!', 'success');
    }

    // Init storage
    await Thresh.Storage.init();

    // Route
    window.addEventListener('hashchange', onRouteChange);
    onRouteChange();

    // Mobile menu
    document.getElementById('mobile-menu-btn').addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Init Lucide icons
    if (window.lucide) {
      lucide.createIcons();
    }

    updateSentinel();
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  // Public API (for onclick handlers in templates)
  return {
    navigate: navigate,
    navigateToThresh: navigateToThresh,
    doExploreSearch: doExploreSearch,
    onSortChange: onSortChange,
    doCollection: doCollection,
    loadHarvest: loadHarvest,
    filterHarvest: filterHarvest,
    deleteHarvestCollection: deleteHarvestCollection,
    loadWinnow: loadWinnow,
    previewProvenance: previewProvenance,
    doExport: doExport,
    connectReddit: connectReddit,
    disconnectReddit: disconnectReddit,
    toast: toast,
  };
})();
