// ============================================================
//  Register Page Logic
//  Path: event-booking/frontend/js/register.js
//  Depends on: js/api.js
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // If already logged in → redirect
  if (isLoggedIn()) {
    const user = currentUser();
    location.href = user?.role === 'admin' ? 'admin.html' : 'index.html';
    return;
  }

  setupRegisterForm();
  setupPasswordStrength();
});

// ============================================================
//  Setup form
// ============================================================
function setupRegisterForm() {
  const form = document.getElementById('registerForm');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const phoneInput = document.getElementById('phone');
  const passwordInput = document.getElementById('password');
  const termsInput = document.getElementById('terms');
  const submitBtn = document.getElementById('registerBtn');

  if (!form) return;

  nameInput?.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alert');

    // ---------- Read values ----------
    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const phone = phoneInput.value.trim();
    const password = passwordInput.value;

    // ---------- Validate ----------
    if (!name || name.length < 2) {
      return showAlert('alert', 'Please enter your full name (min 2 characters)', 'error');
    }
    if (!email) {
      return showAlert('alert', 'Please enter your email address', 'error');
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return showAlert('alert', 'Please enter a valid email address', 'error');
    }
    if (phone && !/^[+\d\s\-()]{6,20}$/.test(phone)) {
      return showAlert('alert', 'Please enter a valid phone number', 'error');
    }
    if (!password || password.length < 6) {
      return showAlert('alert', 'Password must be at least 6 characters', 'error');
    }
    if (!termsInput.checked) {
      return showAlert('alert', 'Please agree to the Terms & Privacy Policy', 'error');
    }

    // ---------- Submit ----------
    setLoading(submitBtn, true, 'Creating account...');

    try {
      const res = await api('/auth/register', 'POST', {
        name,
        email,
        password,
        phone
      });

      if (!res._ok) {
        setLoading(submitBtn, false);
        return handleRegisterError(res);
      }

      handleRegisterSuccess(res, email);

    } catch (err) {
      console.error('Register error:', err);
      setLoading(submitBtn, false);
      showAlert('alert', 'Something went wrong. Please try again.', 'error');
    }
  });

  // Clear errors as user types
  [nameInput, emailInput, phoneInput, passwordInput].forEach((inp) => {
    inp?.addEventListener('input', () => hideAlert('alert'));
  });
}

// ============================================================
//  Success handler
// ============================================================
function handleRegisterSuccess(res, email) {
  // Store pending email so verify.html can use it
  store.setPendingEmail(email);

  showAlert('alert', 'Account created! Check your email for the OTP.', 'success');
  toast('OTP sent to your email 📧', 'success', 2000);

  // Small delay so user sees the message
  setTimeout(() => {
    location.href = 'verify.html';
  }, 1200);
}

// ============================================================
//  Error handler
// ============================================================
function handleRegisterError(res) {
  const msg = (res.msg || '').toLowerCase();

  // Already verified → offer login
  if (msg.includes('already') && msg.includes('verified')) {
    showAlert(
      'alert',
      `${res.msg} <a href="login.html" style="color:#c4b5fd;font-weight:700;margin-left:6px;">Login →</a>`,
      'warning'
    );
    toast('Email already registered', 'warning');
    return;
  }

  // Rate limited
  if (res._status === 429 || msg.includes('too many')) {
    showAlert('alert', 'Too many attempts. Please wait a few minutes and try again.', 'warning');
    return;
  }

  // Fallback
  showAlert('alert', res.msg || 'Registration failed. Please try again.', 'error');
  toast('Registration failed', 'error');
}

// ============================================================
//  Password strength meter
// ============================================================
function setupPasswordStrength() {
  const password = document.getElementById('password');
  const segments = document.querySelectorAll('.pw-seg');
  const hint = document.getElementById('pwHint');

  if (!password || !segments.length) return;

  password.addEventListener('input', () => {
    const value = password.value;
    const score = calculateStrength(value);

    const classes = ['on-weak', 'on-fair', 'on-good', 'on-strong'];
    segments.forEach((seg, i) => {
      seg.classList.remove(...classes);
      if (i < score) seg.classList.add(classes[score - 1]);
    });

    // Update hint text
    const labels = {
      0: { text: 'Use 8+ characters with a mix of letters, numbers & symbols.', color: 'var(--text-4)' },
      1: { text: 'Weak — add more characters and variety.', color: '#fca5a5' },
      2: { text: 'Fair — try adding a number or symbol.', color: '#fcd34d' },
      3: { text: 'Good — add a special character for stronger security.', color: '#67e8f9' },
      4: { text: 'Strong password ✅', color: '#6ee7b7' }
    };
    const info = labels[score] || labels[0];
    hint.textContent = info.text;
    hint.style.color = info.color;
  });
}

// ============================================================
//  Strength algorithm (0–4)
// ============================================================
function calculateStrength(pw) {
  if (!pw) return 0;

  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  // Cap at 4
  return Math.min(score, 4);
}

// ============================================================
//  Esc to dismiss alert
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAlert('alert');
});