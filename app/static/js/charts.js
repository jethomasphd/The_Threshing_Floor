// Chart.js defaults for Thresh design language
if (window.Chart) {
  Chart.defaults.color = '#A8A49C'; // bone-muted
  Chart.defaults.borderColor = 'rgba(61, 61, 74, 0.5)'; // smoke at 50%
  Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
  Chart.defaults.font.size = 12;

  // Thresh color palette for datasets
  window.ThreshChartColors = {
    ember: '#C9A227',
    emberGlow: '#E8C547',
    emberDim: '#8B7121',
    bone: '#E8E4DC',
    ash: '#6B6B7B',
    link: '#7BA3C9',
    success: '#4A9B6E',
    warning: '#D4943A',
    error: '#C44B4B',
  };

  // Utility: returns an array of Thresh colors for multi-series charts
  window.ThreshChartPalette = function(count) {
    var palette = [
      '#C9A227', '#7BA3C9', '#4A9B6E', '#D4943A', '#C44B4B',
      '#E8C547', '#A8C8E8', '#8B7121', '#6B6B7B', '#E8E4DC'
    ];
    var result = [];
    for (var i = 0; i < count; i++) {
      result.push(palette[i % palette.length]);
    }
    return result;
  };
}

// ---------------------------------------------------------------------------
// Harvest — Chart initialization functions
// ---------------------------------------------------------------------------

// Track chart instances so we can destroy on re-render
var _harvestTimelineChart = null;
var _harvestScoreChart = null;

/**
 * Initialize the posts-per-day timeline bar chart.
 * @param {Object} data - { labels: string[], data: number[] }
 */
function initHarvestTimelineChart(data) {
  var canvas = document.getElementById('harvest-timeline-chart');
  if (!canvas) return;

  // Destroy previous instance if it exists
  if (_harvestTimelineChart) {
    _harvestTimelineChart.destroy();
    _harvestTimelineChart = null;
  }

  var ctx = canvas.getContext('2d');
  var colors = window.ThreshChartColors || {};

  // Format labels to shorter dates (e.g. "Jan 15")
  var shortLabels = data.labels.map(function(dateStr) {
    var parts = dateStr.split('-');
    if (parts.length === 3) {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var monthIdx = parseInt(parts[1], 10) - 1;
      return months[monthIdx] + ' ' + parseInt(parts[2], 10);
    }
    return dateStr;
  });

  _harvestTimelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets: [{
        label: 'Posts',
        data: data.data,
        backgroundColor: colors.ember || '#C9A227',
        borderColor: colors.emberGlow || '#E8C547',
        borderWidth: 1,
        borderRadius: 2,
        maxBarThickness: 40,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#1A1A22',
          titleColor: '#E8E4DC',
          bodyColor: '#A8A49C',
          borderColor: 'rgba(201, 162, 39, 0.3)',
          borderWidth: 1,
          cornerRadius: 4,
          padding: 8,
          bodyFont: {
            family: "'IBM Plex Mono', monospace",
            size: 11,
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(61, 61, 74, 0.3)',
            drawBorder: false,
          },
          ticks: {
            maxRotation: 45,
            font: {
              size: 10,
              family: "'IBM Plex Mono', monospace",
            },
            color: '#6B6B7B',
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(61, 61, 74, 0.3)',
            drawBorder: false,
          },
          ticks: {
            precision: 0,
            font: {
              size: 10,
              family: "'IBM Plex Mono', monospace",
            },
            color: '#6B6B7B',
          },
        },
      },
    },
  });
}

/**
 * Initialize the score distribution doughnut chart.
 * @param {Object} data - { labels: string[], data: number[] }
 */
function initHarvestScoreChart(data) {
  var canvas = document.getElementById('harvest-score-chart');
  if (!canvas) return;

  // Destroy previous instance if it exists
  if (_harvestScoreChart) {
    _harvestScoreChart.destroy();
    _harvestScoreChart = null;
  }

  var ctx = canvas.getContext('2d');
  var colors = window.ThreshChartColors || {};

  var segmentColors = [
    colors.ash || '#6B6B7B',       // 0-10: muted
    colors.link || '#7BA3C9',      // 11-100: cool
    colors.ember || '#C9A227',     // 101-1K: ember
    colors.emberGlow || '#E8C547', // 1K+: bright ember
  ];

  _harvestScoreChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.labels,
      datasets: [{
        data: data.data,
        backgroundColor: segmentColors.slice(0, data.labels.length),
        borderColor: '#131318',
        borderWidth: 2,
        hoverBorderColor: '#E8E4DC',
        hoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            font: {
              size: 11,
              family: "'IBM Plex Mono', monospace",
            },
            color: '#A8A49C',
          },
        },
        tooltip: {
          backgroundColor: '#1A1A22',
          titleColor: '#E8E4DC',
          bodyColor: '#A8A49C',
          borderColor: 'rgba(201, 162, 39, 0.3)',
          borderWidth: 1,
          cornerRadius: 4,
          padding: 8,
          bodyFont: {
            family: "'IBM Plex Mono', monospace",
            size: 11,
          },
          callbacks: {
            label: function(context) {
              var total = context.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var value = context.parsed;
              var pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return ' ' + context.label + ': ' + value + ' (' + pct + '%)';
            }
          },
        },
      },
    },
  });
}
