document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alert');
    const btn = document.getElementById('submitBtn');
    const email = document.getElementById('email').value.trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return showAlert('alert', 'Please enter a valid email', 'error');
    }

    setLoading(btn, true, 'Sending...');
    const res = await api('/auth/forgot-password', 'POST', { email });

    if (!res._ok) {
      setLoading(btn, false);
      return showAlert('alert', res.msg || 'Failed to send OTP', 'error');
    }

    store.setResetEmail(res.email || email);
    toast('Reset OTP sent 📧', 'success');
    setTimeout(() => location.href = 'reset.html', 900);
  });
});