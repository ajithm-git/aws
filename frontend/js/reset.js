document.addEventListener('DOMContentLoaded', () => {
  const email = store.getResetEmail();
  if (!email) { location.href = 'forgot.html'; return; }

  document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alert');
    const btn = document.getElementById('submitBtn');

    const otp = document.getElementById('otp').value.trim();
    const password = document.getElementById('password').value;

    if (otp.length !== 6) return showAlert('alert', 'OTP must be 6 digits', 'error');
    if (password.length < 6) return showAlert('alert', 'Password must be at least 6 chars', 'error');

    setLoading(btn, true, 'Resetting...');
    const res = await api('/auth/reset-password', 'POST', { email, otp, password });

    if (!res._ok) {
      setLoading(btn, false);
      return showAlert('alert', res.msg || 'Reset failed', 'error');
    }

    toast('Password reset! Please login 🎉', 'success');
    store.setResetEmail('');
    setTimeout(() => location.href = 'login.html', 1200);
  });
});