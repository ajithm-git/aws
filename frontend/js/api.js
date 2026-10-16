// ============================================================
//  Shared API + Utilities
//  Path: frontend/js/api.js
//  Load AFTER config.js on every page.
// ============================================================

// ============================================================
//  1. CONFIG
//  Reads from window.EVENTBOOK_CONFIG.apiBase (set in config.js)
//  Falls back to the AWS EC2 public IP if not configured.
// ============================================================
const API_ORIGIN = (
  (window.EVENTBOOK_CONFIG && window.EVENTBOOK_CONFIG.apiBase) ||
  'http://52.62.77.45'
).replace(/\/+$/, '');

const API_BASE = `${API_ORIGIN}/api`;

const STORAGE_KEYS = {
  TOKEN: 'eb_token',
  USER: 'eb_user',
  PENDING_EMAIL: 'eb_pending_email',
  RESET_EMAIL: 'eb_reset_email'
};

// ============================================================
//  2. STORAGE HELPERS
// ============================================================
const store = {
  getToken: () => localStorage.getItem(STORAGE_KEYS.TOKEN),
  setToken: (t) => localStorage.setItem(STORAGE_KEYS.TOKEN, t),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null'); }
    catch { return null; }
  },
  setUser: (u) => localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(u)),
  setPendingEmail: (e) => localStorage.setItem(STORAGE_KEYS.PENDING_EMAIL, e),
  getPendingEmail: () => localStorage.getItem(STORAGE_KEYS.PENDING_EMAIL),
  setResetEmail: (e) => localStorage.setItem(STORAGE_KEYS.RESET_EMAIL, e),
  getResetEmail: () => localStorage.getItem(STORAGE_KEYS.RESET_EMAIL),
  clear: () => Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key))
};

// ============================================================
//  3. CORE FETCH WRAPPER
// ============================================================
async function api(path, method = 'GET', body = null, opts = {}) {
  const token = store.getToken();

  const headers = {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {})
  };

  const config = {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  };

  try {
    const res = await fetch(API_BASE + path, config);
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json()
      : { msg: await res.text() };

    // Auto-logout on expired/invalid token
    if (res.status === 401 && !opts.skipAuthRedirect) {
      store.clear();
      if (!location.pathname.includes('login')) {
        location.href = 'login.html';
      }
    }

    if (!res.ok) {
      return { ...data, _status: res.status, _ok: false };
    }

    return { ...data, _status: res.status, _ok: true };
  } catch (err) {
    console.error('API error:', err);
    return {
      msg: 'Network error — check your connection or the API URL.',
      _status: 0,
      _ok: false
    };
  }
}

// ============================================================
//  4. TOAST NOTIFICATIONS
// ============================================================
function ensureToastContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function toast(message, type = 'info', duration = 3200) {
  const container = ensureToastContainer();
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = document.createElement('span');
  icon.style.fontWeight = '800';
  icon.style.fontSize = '16px';
  icon.textContent = icons[type] || '';
  const text = document.createElement('span');
  text.textContent = message;
  el.append(icon, text);

  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'all 0.35s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// ============================================================
//  5. INLINE ALERT
// ============================================================
function showAlert(elementId, message, type = 'error') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = message;
  if (type === 'success') {
    setTimeout(() => { el.classList.remove('show'); }, 4000);
  }
}

function hideAlert(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.classList.remove('show');
}

// ============================================================
//  6. AUTH HELPERS
// ============================================================
function isLoggedIn() {
  return !!store.getToken();
}

function currentUser() {
  return store.getUser();
}

function isAdmin() {
  const u = currentUser();
  return u && u.role === 'admin';
}

function requireAuth(redirectTo = 'login.html') {
  if (!isLoggedIn()) {
    toast('Please login to continue', 'warning');
    setTimeout(() => location.href = redirectTo, 700);
    return false;
  }
  return true;
}

function requireAdmin(redirectTo = 'admin-login.html') {
  if (!isLoggedIn() || !isAdmin()) {
    toast('Admin access required', 'error');
    setTimeout(() => location.href = redirectTo, 700);
    return false;
  }
  return true;
}

function logout() {
  if (!confirm('Logout from EventBook?')) return;
  store.clear();
  toast('Logged out', 'success', 1200);
  setTimeout(() => location.href = 'login.html', 400);
}

// ============================================================
//  7. FORMATTERS
// ============================================================
function formatDate(date, style = 'long') {
  if (!date) return 'TBA';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'TBA';

  if (style === 'short') {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  if (style === 'time') {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTime(date) {
  if (!date) return 'TBA';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'TBA';
  return `${formatDate(d)} • ${formatTime(d)}`;
}

function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

function timeAgo(date) {
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return '—';
  const s = Math.floor((Date.now() - timestamp) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(date, 'short');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getQuery(param) {
  return new URLSearchParams(location.search).get(param);
}

// ============================================================
//  8. UI HELPERS
// ============================================================
function setLoading(btnOrId, isLoading, label = 'Please wait...') {
  const btn = typeof btnOrId === 'string'
    ? document.getElementById(btnOrId)
    : btnOrId;
  if (!btn) return;

  if (isLoading) {
    btn.dataset._html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${label}`;
  } else {
    btn.disabled = false;
    if (btn.dataset._html) btn.innerHTML = btn.dataset._html;
  }
}

function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function togglePassword(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (el.type === 'password') {
    el.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    el.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

// ============================================================
//  9. NAVBAR AUTO-INJECT
// ============================================================
function renderNavbar(activePath = '') {
  const user = currentUser();
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const navLogin = document.getElementById('navLogin');
  const navLogout = document.getElementById('navLogout');
  const navDash = document.getElementById('navDash');
  const navAdmin = document.getElementById('navAdmin');
  const navUser = document.getElementById('navUser');

  if (user) {
    if (navLogin) navLogin.classList.add('hidden');
    if (navLogout) navLogout.classList.remove('hidden');
    if (navDash) navDash.classList.remove('hidden');
    if (navAdmin && user.role === 'admin') navAdmin.classList.remove('hidden');
    if (navUser) {
      navUser.classList.remove('hidden');
      navUser.textContent = user.initials || (user.name || 'U').slice(0, 2).toUpperCase();
    }
  } else {
    if (navLogin) navLogin.classList.remove('hidden');
    if (navLogout) navLogout.classList.add('hidden');
    if (navDash) navDash.classList.add('hidden');
    if (navAdmin) navAdmin.classList.add('hidden');
    if (navUser) navUser.classList.add('hidden');
  }

  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === activePath) {
      a.style.color = 'var(--violet-600)';
    }
  });
}

// Scroll effect for navbar
window.addEventListener('scroll', () => {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  if (window.scrollY > 20) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
});

// ============================================================
//  10. EXPORTS
// ============================================================
window.API_ORIGIN = API_ORIGIN;
window.API_BASE = API_BASE;
window.api = api;
window.store = store;
window.toast = toast;
window.showAlert = showAlert;
window.hideAlert = hideAlert;
window.isLoggedIn = isLoggedIn;
window.currentUser = currentUser;
window.isAdmin = isAdmin;
window.requireAuth = requireAuth;
window.requireAdmin = requireAdmin;
window.logout = logout;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.formatTime = formatTime;
window.formatCurrency = formatCurrency;
window.timeAgo = timeAgo;
window.escapeHtml = escapeHtml;
window.getQuery = getQuery;
window.setLoading = setLoading;
window.debounce = debounce;
window.togglePassword = togglePassword;
window.renderNavbar = renderNavbar;

// Console banner
console.log(
  '%c🎫 EventBook%c  API: ' + API_BASE,
  'background:linear-gradient(135deg,#a855f7,#6366f1);color:#fff;padding:4px 10px;border-radius:6px;font-weight:800;',
  'color:#9ca3af;font-size:12px;'
);