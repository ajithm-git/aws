// ============================================================
//  Verify Page Logic — OTP boxes, timer, resend
//  Path: event-booking/frontend/js/verify.js
//  Depends on: js/api.js
// ============================================================

const VERIFY_EXPIRY_SECONDS = 10 * 60;   // 10 minutes
const RESEND_COOLDOWN_SECONDS = 30;      // Resend cooldown

let verifyState = {
  email: null,
  boxes: [],
  secondsLeft: VERIFY_EXPIRY_SECONDS,
  timerId: null,
  resendCooldownId: null,
  resendCooldown: 0,
  submitting: false
};

// ============================================================
//  1. BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Guard: email must exist
  const email = store.getPendingEmail();
  if (!email) {
    toast('Please register first', 'warning');
    setTimeout(() => location.href = 'register.html', 700);
    return;
  }

  verifyState.email = email;
  document.getElementById('emailDisplay').textContent = email;

  setupOtpBoxes();
  startExpiryTimer();
  setupFormSubmit();
  setupResendButton();
});

// ============================================================
//  2. OTP BOXES — auto-advance, backspace, paste, arrow nav
// ============================================================
function setupOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  verifyState.boxes = boxes;

  boxes.forEach((box, i) => {
    // Only digits allowed
    box.addEventListener('input', (e) => {
      const v = e.target.value.replace(/\D/g, '');
      e.target.value = v.slice(-1); // keep last digit only

      box.classList.toggle('filled', !!box.value);
      box.classList.remove('error');

      if (box.value && i < boxes.length - 1) {
        boxes[i + 1].focus();
      }
      maybeAutoSubmit();
    });

    // Backspace navigation
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!box.value && i > 0) {
          boxes[i - 1].focus();
          boxes[i - 1].value = '';
          boxes[i - 1].classList.remove('filled');
          e.preventDefault();
        } else {
          box.classList.remove('filled');
        }
      }
      if (e.key === 'ArrowLeft' && i > 0) {
        boxes[i - 1].focus();
        e.preventDefault();
      }
      if (e.key === 'ArrowRight' && i < boxes.length - 1) {
        boxes[i + 1].focus();
        e.preventDefault();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('verifyForm').requestSubmit();
      }
    });

    // Select digit on focus
    box.addEventListener('focus', () => box.select());

    // Paste handler (only on first box, but allow on any)
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, 6);
      if (!pasted) return;

      pasted.split('').forEach((digit, idx) => {
        if (boxes[idx]) {
          boxes[idx].value = digit;
          boxes[idx].classList.add('filled');
        }
      });

      // Focus last filled or next empty
      const nextIdx = Math.min(pasted.length, boxes.length - 1);
      boxes[nextIdx].focus();
      maybeAutoSubmit();
    });
  });
}

// Auto submit when all 6 boxes are filled
function maybeAutoSubmit() {
  const code = getOtpValue();
  if (code.length === 6 && !verifyState.submitting) {
    // Small delay so the user sees the last digit filled
    setTimeout(() => {
      document.getElementById('verifyForm').requestSubmit();
    }, 250);
  }
}

// Get the 6-digit OTP as a string
function getOtpValue() {
  return verifyState.boxes.map(b => b.value).join('');
}

// Clear all boxes and focus first
function clearOtpBoxes() {
  verifyState.boxes.forEach(b => {
    b.value = '';
    b.classList.remove('filled', 'error', 'success');
  });
  verifyState.boxes[0]?.focus();
}

// ============================================================
//  3. EXPIRY TIMER (10:00 countdown)
// ============================================================
function startExpiryTimer() {
  const el = document.getElementById('timer');
  verifyState.secondsLeft = VERIFY_EXPIRY_SECONDS;

  const tick = () => {
    const m = Math.floor(verifyState.secondsLeft / 60);
    const s = verifyState.secondsLeft % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    el.style.color = verifyState.secondsLeft <= 60 ? '#fca5a5' : 'var(--violet-400)';

    if (verifyState.secondsLeft <= 0) {
      clearInterval(verifyState.timerId);
      el.textContent = 'Expired';
      showAlert('alert', 'OTP expired. Please click Resend to get a new one.', 'warning');
      return;
    }
    verifyState.secondsLeft--;
  };

  tick();
  verifyState.timerId = setInterval(tick, 1000);
}

// ============================================================
//  4. FORM SUBMIT
// ============================================================
function setupFormSubmit() {
  const form = document.getElementById('verifyForm');
  const btn = document.getElementById('verifyBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (verifyState.submitting) return;

    hideAlert('alert');
    const otp = getOtpValue();

    if (otp.length !== 6) {
      return showAlert('alert', 'Please enter all 6 digits', 'error');
    }

    verifyState.submitting = true;
    setLoading(btn, true, 'Verifying...');

    try {
      const res = await api('/auth/verify-otp', 'POST', {
        email: verifyState.email,
        otp
      });

      if (!res._ok) {
        verifyState.submitting = false;
        setLoading(btn, false);
        return handleVerifyError(res);
      }

      handleVerifySuccess();

    } catch (err) {
      console.error('Verify error:', err);
      verifyState.submitting = false;
      setLoading(btn, false);
      markBoxesError();
      showAlert('alert', 'Something went wrong. Please try again.', 'error');
    }
  });
}

// ============================================================
//  5. SUCCESS
// ============================================================
function handleVerifySuccess() {
  // Green success state on boxes
  verifyState.boxes.forEach(b => {
    b.classList.remove('error');
    b.classList.add('success');
    b.disabled = true;
  });

  clearInterval(verifyState.timerId);

  showAlert('alert', '✅ Email verified! Redirecting to login...', 'success');
  toast('Email verified successfully 🎉', 'success', 2000);

  // Clear pending email — no longer needed
  store.setPendingEmail('');

  setTimeout(() => {
    location.href = 'login.html';
  }, 1400);
}

// ============================================================
//  6. ERROR
// ============================================================
function handleVerifyError(res) {
  const msg = (res.msg || '').toLowerCase();

  markBoxesError();

  if (msg.includes('expired')) {
    showAlert('alert', 'OTP has expired. Please click Resend to get a new one.', 'warning');
    return;
  }
  if (msg.includes('invalid')) {
    showAlert('alert', 'Incorrect OTP. Please check the digits and try again.', 'error');
    toast('Invalid OTP', 'error');
    clearOtpBoxes();
    return;
  }
  if (msg.includes('already verified')) {
    showAlert('alert', 'This email is already verified. Redirecting to login...', 'success');
    setTimeout(() => location.href = 'login.html', 1200);
    return;
  }
  if (res._status === 429) {
    showAlert('alert', 'Too many attempts. Please wait a few minutes.', 'warning');
    return;
  }

  showAlert('alert', res.msg || 'Verification failed. Please try again.', 'error');
}

function markBoxesError() {
  verifyState.boxes.forEach(b => {
    b.classList.remove('filled', 'success');
    b.classList.add('error');
  });
}

// ============================================================
//  7. RESEND BUTTON
// ============================================================
function setupResendButton() {
  const btn = document.getElementById('resendBtn');

  btn.addEventListener('click', async () => {
    if (verifyState.resendCooldown > 0) return;

    hideAlert('alert');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const res = await api('/auth/resend-otp', 'POST', {
        email: verifyState.email
      });

      if (!res._ok) {
        btn.disabled = false;
        btn.textContent = 'Resend';
        showAlert('alert', res.msg || 'Could not resend OTP.', 'error');
        return;
      }

      // Reset UI
      clearOtpBoxes();
      startExpiryTimer(); // restart 10-min timer
      toast('New OTP sent to your email 📧', 'success');
      showAlert('alert', 'A new OTP has been sent. Please check your inbox.', 'success');
      startResendCooldown();

    } catch (err) {
      console.error('Resend error:', err);
      btn.disabled = false;
      btn.textContent = 'Resend';
      showAlert('alert', 'Something went wrong. Please try again.', 'error');
    }
  });

  // Initial cooldown on page load (avoid immediate resend)
  startResendCooldown();
}

function startResendCooldown() {
  const btn = document.getElementById('resendBtn');
  verifyState.resendCooldown = RESEND_COOLDOWN_SECONDS;

  const tick = () => {
    if (verifyState.resendCooldown <= 0) {
      clearInterval(verifyState.resendCooldownId);
      btn.disabled = false;
      btn.textContent = 'Resend';
      btn.style.opacity = '1';
      return;
    }
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.textContent = `Resend (${verifyState.resendCooldown}s)`;
    verifyState.resendCooldown--;
  };

  tick();
  verifyState.resendCooldownId = setInterval(tick, 1000);
}

// ============================================================
//  8. CLEANUP
// ============================================================
window.addEventListener('beforeunload', () => {
  clearInterval(verifyState.timerId);
  clearInterval(verifyState.resendCooldownId);
});