// ---------------------------------------------------------------------------
// Winnow — Analysis page JavaScript
// Handles tab switching, Plotly.js chart rendering, and API data loading.
// ---------------------------------------------------------------------------

// Thresh color palette for Plotly charts
var THRESH_COLORS = {
  ember: '#C9A227',
  emberGlow: '#E8C547',
  emberDim: '#8B7121',
  bone: '#E8E4DC',
  boneMuted: '#A8A49C',
  ash: '#6B6B7B',
  smoke: '#3D3D4A',
  surface: '#131318',
  surfaceRaised: '#1A1A22',
  ground: '#0A0A0F',
  link: '#7BA3C9',
  success: '#4A9B6E',
  warning: '#D4943A',
  error: '#C44B4B',
};

// Multi-series color palette
var THRESH_PALETTE = [
  '#C9A227', '#7BA3C9', '#4A9B6E', '#D4943A', '#C44B4B',
  '#E8C547', '#A8C8E8', '#8B7121', '#6B6B7B', '#E8E4DC',
];

// Plotly layout defaults for Thresh design language
var PLOTLY_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(19,19,24,0.5)',
  font: { family: 'IBM Plex Sans, sans-serif', color: '#A8A49C', size: 12 },
  xaxis: { gridcolor: '#3D3D4A', linecolor: '#3D3D4A', zerolinecolor: '#3D3D4A' },
  yaxis: { gridcolor: '#3D3D4A', linecolor: '#3D3D4A', zerolinecolor: '#3D3D4A' },
  margin: { t: 40, r: 20, b: 60, l: 60 },
};

var PLOTLY_CONFIG = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  displaylogo: false,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var winnowState = {
  jobId: null,
  activeTab: 'words',
  keywords: [],
  wordFreqOptions: {
    includeComments: true,
    minLength: 3,
    topN: 50,
  },
  temporalInterval: 'day',
  keywordInterval: 'day',
};

// ---------------------------------------------------------------------------
// Tab Management
// ---------------------------------------------------------------------------

function switchWinnowTab(tabName) {
  winnowState.activeTab = tabName;

  // Update tab buttons
  var tabBtns = document.querySelectorAll('.winnow-tab-btn');
  for (var i = 0; i < tabBtns.length; i++) {
    var btn = tabBtns[i];
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }

  // Update tab panels
  var panels = document.querySelectorAll('.winnow-tab-panel');
  for (var j = 0; j < panels.length; j++) {
    var panel = panels[j];
    if (panel.id === 'winnow-panel-' + tabName) {
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  }

  // Load data for the active tab if we have a job
  if (winnowState.jobId) {
    loadTabData(tabName);
  }
}

// ---------------------------------------------------------------------------
// Job Selection
// ---------------------------------------------------------------------------

function loadWinnowJob(jobId) {
  if (!jobId) {
    winnowState.jobId = null;
    // Hide the analysis area
    var analysisArea = document.getElementById('winnow-analysis');
    if (analysisArea) analysisArea.style.display = 'none';
    var emptyState = document.getElementById('winnow-select-prompt');
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  winnowState.jobId = jobId;

  // Show analysis area, hide prompt
  var analysisArea = document.getElementById('winnow-analysis');
  if (analysisArea) analysisArea.style.display = 'block';
  var emptyState = document.getElementById('winnow-select-prompt');
  if (emptyState) emptyState.style.display = 'none';

  // Reset keywords
  winnowState.keywords = [];
  renderKeywordTags();

  // Load the active tab's data
  loadTabData(winnowState.activeTab);
}

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

function loadTabData(tabName) {
  switch (tabName) {
    case 'words':
      loadWordFrequency();
      loadBigrams();
      break;
    case 'temporal':
      loadTemporalDistribution();
      break;
    case 'keywords':
      if (winnowState.keywords.length > 0) {
        loadKeywordTrends();
      }
      break;
    case 'engagement':
      loadEngagementStats();
      break;
  }
}

// ---------------------------------------------------------------------------
// Word Frequency
// ---------------------------------------------------------------------------

function loadWordFrequency() {
  var container = document.getElementById('winnow-wordfreq-chart');
  if (!container) return;

  showChartLoading(container);

  var opts = winnowState.wordFreqOptions;
  var url = '/api/winnow/' + winnowState.jobId + '/word-frequency' +
    '?top_n=' + opts.topN +
    '&include_comments=' + opts.includeComments +
    '&min_length=' + opts.minLength;

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        showChartError(container, data.error);
        return;
      }
      renderWordFreqChart(data);
    })
    .catch(function(err) {
      showChartError(container, 'Failed to load word frequencies.');
    });
}

function renderWordFreqChart(data) {
  var container = document.getElementById('winnow-wordfreq-chart');
  if (!container || !data.words || data.words.length === 0) {
    showChartEmpty(container, 'No word data available.');
    return;
  }

  // Horizontal bar chart — reverse for Plotly (bottom to top)
  var words = data.words.slice().reverse();
  var counts = data.counts.slice().reverse();

  var trace = {
    type: 'bar',
    orientation: 'h',
    x: counts,
    y: words,
    marker: {
      color: THRESH_COLORS.ember,
      line: { color: THRESH_COLORS.emberGlow, width: 0.5 },
    },
    hovertemplate: '<b>%{y}</b>: %{x}<extra></extra>',
  };

  var layout = Object.assign({}, PLOTLY_LAYOUT, {
    title: {
      text: 'Top ' + data.words.length + ' Words',
      font: { family: 'Cormorant Garamond, serif', size: 18, color: THRESH_COLORS.bone },
    },
    xaxis: Object.assign({}, PLOTLY_LAYOUT.xaxis, {
      title: { text: 'Frequency', font: { size: 11 } },
    }),
    yaxis: Object.assign({}, PLOTLY_LAYOUT.yaxis, {
      tickfont: { family: 'IBM Plex Mono, monospace', size: 10, color: THRESH_COLORS.boneMuted },
      automargin: true,
    }),
    margin: { t: 50, r: 20, b: 50, l: 120 },
    height: Math.max(400, data.words.length * 18),
  });

  container.innerHTML = '';
  Plotly.newPlot(container, [trace], layout, PLOTLY_CONFIG);
}

function updateWordFreqOptions() {
  var includeComments = document.getElementById('winnow-wf-comments');
  var minLength = document.getElementById('winnow-wf-minlength');
  var topN = document.getElementById('winnow-wf-topn');

  if (includeComments) {
    winnowState.wordFreqOptions.includeComments = includeComments.checked;
  }
  if (minLength) {
    winnowState.wordFreqOptions.minLength = parseInt(minLength.value) || 3;
  }
  if (topN) {
    winnowState.wordFreqOptions.topN = parseInt(topN.value) || 50;
  }

  if (winnowState.jobId) {
    loadWordFrequency();
    loadBigrams();
  }
}

// ---------------------------------------------------------------------------
// Bigrams
// ---------------------------------------------------------------------------

function loadBigrams() {
  var container = document.getElementById('winnow-bigrams-table');
  if (!container) return;

  container.innerHTML =
    '<div class="loading-state" style="padding: 1rem;">' +
    '<img src="/static/img/sigil.svg" alt="Loading" class="loading-sigil" style="width: 24px; height: 24px;">' +
    '<span class="loading-text text-xs">Computing bigrams...</span></div>';

  var url = '/api/winnow/' + winnowState.jobId + '/bigrams' +
    '?top_n=30&include_comments=' + winnowState.wordFreqOptions.includeComments;

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        container.innerHTML = '<p class="text-error text-sm">' + data.error + '</p>';
        return;
      }
      renderBigramsTable(data);
    })
    .catch(function(err) {
      container.innerHTML = '<p class="text-error text-sm">Failed to load bigrams.</p>';
    });
}

function renderBigramsTable(data) {
  var container = document.getElementById('winnow-bigrams-table');
  if (!container) return;

  if (!data.bigrams || data.bigrams.length === 0) {
    container.innerHTML = '<p class="text-bone-muted text-sm" style="padding: 1rem;">No bigrams found.</p>';
    return;
  }

  var html = '<div class="table-wrapper"><table class="data-table">' +
    '<thead><tr>' +
    '<th style="width: 40px;">#</th>' +
    '<th>Phrase</th>' +
    '<th style="text-align: right;">Count</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < data.bigrams.length; i++) {
    html += '<tr>' +
      '<td class="text-ash">' + (i + 1) + '</td>' +
      '<td>' + escapeHtml(data.bigrams[i]) + '</td>' +
      '<td style="text-align: right; color: var(--ember);">' + data.counts[i] + '</td>' +
      '</tr>';
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Temporal Distribution
// ---------------------------------------------------------------------------

function loadTemporalDistribution() {
  var container = document.getElementById('winnow-temporal-chart');
  if (!container) return;

  showChartLoading(container);

  var url = '/api/winnow/' + winnowState.jobId + '/temporal' +
    '?interval=' + winnowState.temporalInterval;

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        showChartError(container, data.error);
        return;
      }
      renderTemporalChart(data);
    })
    .catch(function(err) {
      showChartError(container, 'Failed to load temporal data.');
    });
}

function renderTemporalChart(data) {
  var container = document.getElementById('winnow-temporal-chart');
  if (!container || !data.dates || data.dates.length === 0) {
    showChartEmpty(container, 'No temporal data available.');
    return;
  }

  var trace = {
    type: 'scatter',
    mode: 'lines+markers',
    x: data.dates,
    y: data.counts,
    line: { color: THRESH_COLORS.ember, width: 2, shape: 'spline' },
    marker: { color: THRESH_COLORS.emberGlow, size: 6, line: { color: THRESH_COLORS.ember, width: 1 } },
    fill: 'tozeroy',
    fillcolor: 'rgba(201, 162, 39, 0.1)',
    hovertemplate: '<b>%{x}</b><br>Posts: %{y}<extra></extra>',
  };

  var layout = Object.assign({}, PLOTLY_LAYOUT, {
    title: {
      text: 'Post Volume Over Time',
      font: { family: 'Cormorant Garamond, serif', size: 18, color: THRESH_COLORS.bone },
    },
    xaxis: Object.assign({}, PLOTLY_LAYOUT.xaxis, {
      title: { text: 'Date', font: { size: 11 } },
      tickfont: { family: 'IBM Plex Mono, monospace', size: 10 },
      rangeslider: { visible: true, bgcolor: THRESH_COLORS.surfaceRaised, bordercolor: THRESH_COLORS.smoke },
    }),
    yaxis: Object.assign({}, PLOTLY_LAYOUT.yaxis, {
      title: { text: 'Post Count', font: { size: 11 } },
      rangemode: 'tozero',
    }),
    height: 450,
  });

  container.innerHTML = '';
  Plotly.newPlot(container, [trace], layout, PLOTLY_CONFIG);
}

function setTemporalInterval(interval) {
  winnowState.temporalInterval = interval;

  // Update button states
  var btns = document.querySelectorAll('.winnow-interval-btn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].dataset.interval === interval) {
      btns[i].classList.add('active');
    } else {
      btns[i].classList.remove('active');
    }
  }

  if (winnowState.jobId) {
    loadTemporalDistribution();
  }
}

// ---------------------------------------------------------------------------
// Keyword Tracking
// ---------------------------------------------------------------------------

function addKeyword() {
  var input = document.getElementById('winnow-keyword-input');
  if (!input) return;

  var keyword = input.value.trim().toLowerCase();
  if (!keyword) return;

  // Avoid duplicates
  if (winnowState.keywords.indexOf(keyword) !== -1) {
    input.value = '';
    return;
  }

  // Limit to 10 keywords
  if (winnowState.keywords.length >= 10) {
    showToast('Maximum 10 keywords allowed.', 'warning');
    return;
  }

  winnowState.keywords.push(keyword);
  input.value = '';
  renderKeywordTags();

  if (winnowState.jobId) {
    loadKeywordTrends();
  }
}

function removeKeyword(keyword) {
  var idx = winnowState.keywords.indexOf(keyword);
  if (idx > -1) {
    winnowState.keywords.splice(idx, 1);
    renderKeywordTags();
    if (winnowState.jobId && winnowState.keywords.length > 0) {
      loadKeywordTrends();
    } else {
      var container = document.getElementById('winnow-keywords-chart');
      if (container) {
        showChartEmpty(container, 'Add keywords above to track their frequency over time.');
      }
    }
  }
}

function renderKeywordTags() {
  var tagsContainer = document.getElementById('winnow-keyword-tags');
  if (!tagsContainer) return;

  if (winnowState.keywords.length === 0) {
    tagsContainer.innerHTML = '';
    return;
  }

  var html = '';
  for (var i = 0; i < winnowState.keywords.length; i++) {
    var kw = winnowState.keywords[i];
    html += '<span class="tag tag-removable" onclick="removeKeyword(\'' +
      escapeHtml(kw) + '\')" title="Click to remove">' +
      escapeHtml(kw) +
      ' <span style="margin-left: 0.25rem; color: var(--error);">&times;</span>' +
      '</span> ';
  }
  tagsContainer.innerHTML = html;
}

function loadKeywordTrends() {
  var container = document.getElementById('winnow-keywords-chart');
  if (!container) return;

  if (winnowState.keywords.length === 0) {
    showChartEmpty(container, 'Add keywords above to track their frequency over time.');
    return;
  }

  showChartLoading(container);

  var url = '/api/winnow/' + winnowState.jobId + '/keywords' +
    '?keywords=' + encodeURIComponent(winnowState.keywords.join(',')) +
    '&interval=' + winnowState.keywordInterval;

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        showChartError(container, data.error);
        return;
      }
      renderKeywordChart(data);
    })
    .catch(function(err) {
      showChartError(container, 'Failed to load keyword trends.');
    });
}

function renderKeywordChart(data) {
  var container = document.getElementById('winnow-keywords-chart');
  if (!container || !data.trends) {
    showChartEmpty(container, 'No keyword data available.');
    return;
  }

  var traces = [];
  var keywords = Object.keys(data.trends);

  for (var i = 0; i < keywords.length; i++) {
    var kw = keywords[i];
    var points = data.trends[kw];
    var dates = points.map(function(p) { return p.date; });
    var counts = points.map(function(p) { return p.count; });
    var color = THRESH_PALETTE[i % THRESH_PALETTE.length];

    traces.push({
      type: 'scatter',
      mode: 'lines+markers',
      name: kw,
      x: dates,
      y: counts,
      line: { color: color, width: 2 },
      marker: { color: color, size: 6 },
      hovertemplate: '<b>' + escapeHtml(kw) + '</b><br>%{x}: %{y}<extra></extra>',
    });
  }

  if (traces.length === 0) {
    showChartEmpty(container, 'No data for selected keywords.');
    return;
  }

  var layout = Object.assign({}, PLOTLY_LAYOUT, {
    title: {
      text: 'Keyword Frequency Over Time',
      font: { family: 'Cormorant Garamond, serif', size: 18, color: THRESH_COLORS.bone },
    },
    xaxis: Object.assign({}, PLOTLY_LAYOUT.xaxis, {
      title: { text: 'Date', font: { size: 11 } },
      tickfont: { family: 'IBM Plex Mono, monospace', size: 10 },
    }),
    yaxis: Object.assign({}, PLOTLY_LAYOUT.yaxis, {
      title: { text: 'Mentions', font: { size: 11 } },
      rangemode: 'tozero',
    }),
    legend: {
      font: { color: THRESH_COLORS.boneMuted, size: 11 },
      bgcolor: 'rgba(0,0,0,0)',
    },
    height: 400,
  });

  container.innerHTML = '';
  Plotly.newPlot(container, traces, layout, PLOTLY_CONFIG);
}

function setKeywordInterval(interval) {
  winnowState.keywordInterval = interval;

  var btns = document.querySelectorAll('.winnow-kw-interval-btn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].dataset.interval === interval) {
      btns[i].classList.add('active');
    } else {
      btns[i].classList.remove('active');
    }
  }

  if (winnowState.jobId && winnowState.keywords.length > 0) {
    loadKeywordTrends();
  }
}

// ---------------------------------------------------------------------------
// Engagement Stats
// ---------------------------------------------------------------------------

function loadEngagementStats() {
  var container = document.getElementById('winnow-engagement-content');
  if (!container) return;

  container.innerHTML =
    '<div class="loading-state" style="padding: 2rem;">' +
    '<img src="/static/img/sigil.svg" alt="Loading" class="loading-sigil">' +
    '<span class="loading-text">Computing engagement metrics...</span></div>';

  var url = '/api/winnow/' + winnowState.jobId + '/engagement';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        container.innerHTML = '<p class="text-error text-sm">' + data.error + '</p>';
        return;
      }
      renderEngagementStats(data);
    })
    .catch(function(err) {
      container.innerHTML = '<p class="text-error text-sm">Failed to load engagement data.</p>';
    });
}

function renderEngagementStats(data) {
  var container = document.getElementById('winnow-engagement-content');
  if (!container) return;

  var dateRange = 'N/A';
  if (data.date_range && data.date_range.start && data.date_range.end) {
    dateRange = data.date_range.start + ' to ' + data.date_range.end;
  }

  // Stats cards
  var html =
    '<div class="winnow-stats-grid">' +
    renderStatCard('Total Posts', data.total_posts, 'file-text') +
    renderStatCard('Total Comments', data.total_comments, 'message-square') +
    renderStatCard('Unique Authors', data.unique_authors, 'users') +
    renderStatCard('Avg Score', data.avg_score, 'trending-up') +
    renderStatCard('Median Score', data.median_score, 'bar-chart-2') +
    renderStatCard('Score Std Dev', data.score_std_dev, 'activity') +
    renderStatCard('Avg Comments/Post', data.avg_comments_per_post, 'message-circle') +
    renderStatCard('Date Range', dateRange, 'calendar') +
    '</div>';

  // Score distribution histogram
  html += '<div style="margin-top: 1.5rem;">' +
    '<div id="winnow-score-histogram" style="width: 100%; min-height: 350px;"></div>' +
    '</div>';

  // Author leaderboard
  html += '<div style="margin-top: 1.5rem;">' +
    '<h3 style="font-family: var(--font-display); font-size: 1.25rem; color: var(--bone); margin-bottom: 0.75rem;">' +
    'Top Authors</h3>' +
    '<div id="winnow-authors-table"></div>' +
    '</div>';

  container.innerHTML = html;

  // Reinitialize Lucide icons after inserting new HTML
  if (window.lucide) lucide.createIcons();

  // Render histogram
  if (data.score_histogram && data.score_histogram.length > 0) {
    renderScoreHistogram(data.score_histogram);
  }

  // Load author stats
  loadAuthorStats();
}

function renderStatCard(label, value, icon) {
  return '<div class="card winnow-stat-card">' +
    '<div class="flex items-center gap-2 mb-1">' +
    '<i data-lucide="' + icon + '" style="width: 16px; height: 16px; color: var(--ember-dim);"></i>' +
    '<span class="stat-label" style="margin: 0;">' + escapeHtml(label) + '</span>' +
    '</div>' +
    '<div class="stat-value" style="font-size: 1.5rem;">' + escapeHtml(String(value)) + '</div>' +
    '</div>';
}

function renderScoreHistogram(histogram) {
  var container = document.getElementById('winnow-score-histogram');
  if (!container || !histogram || histogram.length === 0) return;

  var labels = histogram.map(function(b) { return b.range; });
  var counts = histogram.map(function(b) { return b.count; });

  var trace = {
    type: 'bar',
    x: labels,
    y: counts,
    marker: {
      color: THRESH_COLORS.ember,
      line: { color: THRESH_COLORS.emberGlow, width: 0.5 },
    },
    hovertemplate: 'Score %{x}<br>Posts: %{y}<extra></extra>',
  };

  var layout = Object.assign({}, PLOTLY_LAYOUT, {
    title: {
      text: 'Score Distribution',
      font: { family: 'Cormorant Garamond, serif', size: 18, color: THRESH_COLORS.bone },
    },
    xaxis: Object.assign({}, PLOTLY_LAYOUT.xaxis, {
      title: { text: 'Score Range', font: { size: 11 } },
      tickfont: { family: 'IBM Plex Mono, monospace', size: 9 },
      tickangle: -45,
    }),
    yaxis: Object.assign({}, PLOTLY_LAYOUT.yaxis, {
      title: { text: 'Number of Posts', font: { size: 11 } },
      rangemode: 'tozero',
    }),
    height: 350,
    bargap: 0.05,
  });

  Plotly.newPlot(container, [trace], layout, PLOTLY_CONFIG);
}

function loadAuthorStats() {
  var container = document.getElementById('winnow-authors-table');
  if (!container) return;

  container.innerHTML =
    '<div class="loading-state" style="padding: 1rem;">' +
    '<img src="/static/img/sigil.svg" alt="Loading" class="loading-sigil" style="width: 24px; height: 24px;">' +
    '<span class="loading-text text-xs">Loading authors...</span></div>';

  var url = '/api/winnow/' + winnowState.jobId + '/authors?top_n=20';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        container.innerHTML = '<p class="text-error text-sm">' + data.error + '</p>';
        return;
      }
      renderAuthorsTable(data);
    })
    .catch(function(err) {
      container.innerHTML = '<p class="text-error text-sm">Failed to load author stats.</p>';
    });
}

function renderAuthorsTable(data) {
  var container = document.getElementById('winnow-authors-table');
  if (!container) return;

  if (!data.authors || data.authors.length === 0) {
    container.innerHTML = '<p class="text-bone-muted text-sm">No author data available.</p>';
    return;
  }

  var html = '<div class="table-wrapper"><table class="data-table">' +
    '<thead><tr>' +
    '<th style="width: 40px;">#</th>' +
    '<th>Author</th>' +
    '<th style="text-align: right;">Posts</th>' +
    '<th style="text-align: right;">Avg Score</th>' +
    '<th style="text-align: right;">Comments</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < data.authors.length; i++) {
    var a = data.authors[i];
    html += '<tr>' +
      '<td class="text-ash">' + (i + 1) + '</td>' +
      '<td>' + escapeHtml(a.author) + '</td>' +
      '<td style="text-align: right;">' + a.posts + '</td>' +
      '<td style="text-align: right; color: var(--ember);">' + a.avg_score + '</td>' +
      '<td style="text-align: right;">' + a.total_comments + '</td>' +
      '</tr>';
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

function showChartLoading(container) {
  if (!container) return;
  container.innerHTML =
    '<div class="loading-state" style="padding: 3rem 1rem; min-height: 200px;">' +
    '<img src="/static/img/sigil.svg" alt="Loading" class="loading-sigil">' +
    '<span class="loading-text">Analyzing data...</span></div>';
}

function showChartError(container, message) {
  if (!container) return;
  container.innerHTML =
    '<div class="flex items-center justify-center" style="padding: 2rem; min-height: 200px;">' +
    '<p class="text-error text-sm">' + escapeHtml(message) + '</p></div>';
}

function showChartEmpty(container, message) {
  if (!container) return;
  container.innerHTML =
    '<div class="flex flex-col items-center justify-center" style="padding: 2rem; min-height: 200px;">' +
    '<i data-lucide="bar-chart-2" style="width: 32px; height: 32px; color: var(--ash); opacity: 0.4; margin-bottom: 0.75rem;"></i>' +
    '<p class="text-bone-muted text-sm">' + escapeHtml(message) + '</p></div>';
  if (window.lucide) lucide.createIcons();
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function showToast(message, type) {
  // Use global toast if available
  var container = document.getElementById('toast-container');
  if (!container) return;

  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.innerHTML =
    '<span class="toast-message">' + escapeHtml(message) + '</span>' +
    '<button class="toast-close" onclick="this.parentNode.remove()">&times;</button>';
  container.appendChild(toast);

  // Animate in
  setTimeout(function() { toast.classList.add('toast-visible'); }, 10);

  // Auto-dismiss
  setTimeout(function() {
    toast.classList.remove('toast-visible');
    setTimeout(function() { toast.remove(); }, 300);
  }, 4000);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function() {
  // Keyword input: Enter key
  var kwInput = document.getElementById('winnow-keyword-input');
  if (kwInput) {
    kwInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addKeyword();
      }
    });
  }

  // Auto-load if job is pre-selected
  if (winnowState.jobId) {
    loadWinnowJob(winnowState.jobId);
  }
});
