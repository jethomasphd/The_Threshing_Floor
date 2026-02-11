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
