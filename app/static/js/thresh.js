// The Threshing Floor — Global JavaScript
// Utilities, HTMX configuration, toast notification system

// HTMX configuration
document.body.addEventListener('htmx:configRequest', function(evt) {
  // Add CSRF or default headers here if needed in the future
});

// Toast notification system
const ThreshToast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
  },

  show(message, type = 'info', duration = 4000) {
    if (!this.container) this.init();
    if (!this.container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    this.container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    // Auto-dismiss
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); }
};

// HTMX event handlers
document.body.addEventListener('htmx:responseError', function(evt) {
  ThreshToast.error('Something went wrong. Please try again.');
});

// Handle HTMX-triggered toasts via response headers
document.body.addEventListener('htmx:afterRequest', function(evt) {
  const xhr = evt.detail.xhr;
  if (xhr) {
    const toastMsg = xhr.getResponseHeader('HX-Trigger-Toast');
    const toastType = xhr.getResponseHeader('HX-Trigger-Toast-Type') || 'info';
    if (toastMsg) {
      ThreshToast.show(toastMsg, toastType);
    }
  }
});

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  ThreshToast.init();

  // Initialize Lucide icons
  if (window.lucide) {
    lucide.createIcons();
  }
});

// Re-initialize icons after HTMX swaps
document.body.addEventListener('htmx:afterSwap', function() {
  if (window.lucide) {
    lucide.createIcons();
  }
});

// Make ThreshToast globally available
window.ThreshToast = ThreshToast;
