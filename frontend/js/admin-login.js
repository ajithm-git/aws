document.addEventListener('DOMContentLoaded', () => {
  if (isLoggedIn() && isAdmin()) location.href = 'admin.html';

  document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alert');
    const btn = document.getElementById('submitBtn');
    setLoading(btn, true, 'Verifying...');

    const res = await api('/auth/admin-login', 'POST', {
      email: document.getElementById('email').value.trim().toLowerCase(),
      password: document.getElementById('password').value
    });

    if (!res._ok) {
      setLoading(btn, false);
      showAlert('alert', res.msg || 'Invalid admin credentials', 'error');
      return;
    }

    store.setToken(res.token);
    store.setUser(res.user);
    toast('Welcome, Admin 🛡️', 'success');
    setTimeout(() => location.href = 'admin.html', 800);
  });
});