// ============================================================
//  Login Page Logic
//  Path: event-booking/frontend/js/login.js
//  Depends on: js/api.js
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // If already logged in → redirect to correct home
  if (isLoggedIn()) {
    const user = currentUser();
    if (user && user.role === 'admin') {
      location.href = 'admin.html';
    } else {
      location.href = 'index.html';
    }
    return;
  }

  setupLoginForm();
});

// ============================================================
//  Setup form
// ============================================================
function setupLoginForm() {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const submitBtn = document.getElementById('loginBtn');

  if (!form) return;

  // Focus email on load
  emailInput?.focus();

  // ---------- Submit handler ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alert');

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    // ---------- Client-side validation ----------
    if (!email) {
      return showAlert('alert', 'Please enter your email address', 'error');
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return showAlert('alert', 'Please enter a valid email address', 'error');
    }
    if (!password) {
      return showAlert('alert', 'Please enter your password', 'error');
    }
    if (password.length < 6) {
      return showAlert('alert', 'Password must be at least 6 characters', 'error');
    }

    // ---------- Call API ----------
    setLoading(submitBtn, true, 'Signing in...');

    try {
      const res = await api('/auth/login', 'POST', { email, password });

      if (!res._ok) {
        setLoading(submitBtn, false);
        return handleLoginError(res);
      }

      // ---------- Success ----------
      handleLoginSuccess(res);

    } catch (err) {
      console.error('Login error:', err);
      setLoading(submitBtn, false);
      showAlert('alert', 'Something went wrong. Please try again.', 'error');
    }
  });

  // ---------- Enter to submit ----------
  passwordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

// ============================================================
//  Success handler
// ============================================================
function handleLoginSuccess(res) {
  // Store token + user
  store.setToken(res.token);
  store.setUser(res.user);

  // Success alert + toast
  showAlert('alert', `Welcome back, ${res.user.name.split(' ')[0]}! Redirecting...`, 'success');
  toast(`Welcome back, ${res.user.name.split(' ')[0]}! 🎉`, 'success', 1600);

  // Redirect after short delay
  setTimeout(() => {
    // Admins should not land here often, but just in case
    if (res.user.role === 'admin') {
      location.href = 'admin.html';
    } else {
      const redirect = getQuery('redirect');
      location.href = redirect ? decodeURIComponent(redirect) : 'index.html';
    }
  }, 900);
}

// ============================================================
//  Error handler — messages tailored to backend responses
// ============================================================
function handleLoginError(res) {
  const msg = (res.msg || '').toLowerCase();

  // Not verified → offer to resend OTP
  if (msg.includes('verify')) {
    showAlert(
      'alert',
      `${res.msg} <a href="verify.html" style="color:#c4b5fd;font-weight:700;margin-left:6px;">Verify now →</a>`,
      'warning'
    );
    store.setPendingEmail(document.getElementById('email').value.trim().toLowerCase());
    toast('Please verify your email first', 'warning');
    return;
  }

  // Admin trying to log in as user
  if (msg.includes('admin')) {
    showAlert(
      'alert',
      `${res.msg} <a href="admin-login.html" style="color:#c4b5fd;font-weight:700;margin-left:6px;">Go to Admin Login →</a>`,
      'info'
    );
    toast('Use the admin login page', 'info');
    return;
  }

  // Invalid credentials
  if (msg.includes('invalid')) {
    showAlert('alert', 'Invalid email or password. Please try again.', 'error');
    toast('Invalid credentials', 'error');
    // Clear password for security
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
    return;
  }

  // Rate limit
  if (res._status === 429 || msg.includes('too many')) {
    showAlert('alert', 'Too many attempts. Please wait 15 minutes and try again.', 'warning');
    return;
  }

  // Fallback
  showAlert('alert', res.msg || 'Login failed. Please try again.', 'error');
}

// ============================================================
//  Global keyboard: Esc clears alert
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAlert('alert');
});