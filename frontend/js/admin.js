document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAdmin()) return;
  document.getElementById('e_date').min = new Date().toISOString().split('T')[0];
  setupCreateForm();
  await loadAll();
});

async function loadAll() {
  await Promise.all([loadStats(), loadEvents(), loadUsers(), loadBookings()]);
}

async function loadStats() {
  const s = await api('/admin/stats');
  if (!s || s._ok === false) return;
  document.getElementById('stats').innerHTML = `
    ${statCard('👥', 'Users', s.users.total)}
    ${statCard('📅', 'Events', s.events.active)}
    ${statCard('🎟️', 'Bookings', s.bookings.confirmed)}
    ${statCard('💰', 'Collected revenue', formatCurrency(s.revenue))}
  `;
}
function statCard(icon, label, value) {
  return `<div class="stat-card">
    <div class="stat-icon">${icon}</div>
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
  </div>`;
}

async function loadEvents() {
  const res = await api('/events?limit=50&sort=-date');
  const events = res.events || [];
  document.getElementById('eventList').innerHTML = events.length
    ? events.map(e => `
      <div class="glass" style="padding:16px;border-radius:14px;display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <div style="min-width:0;">
          <div style="font-weight:800;font-size:14px;">${escapeHtml(e.title)}</div>
          <div style="font-size:11px;color:var(--text-3);">${escapeHtml(e.venue)} • ${formatDate(e.date)}</div>
          <div style="font-size:11px;color:var(--violet-400);">${e.bookedSeats}/${e.totalSeats} booked • ${formatCurrency(e.price)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="color:#fca5a5;" onclick="delEvent('${e._id}')">Delete</button>
      </div>`).join('')
    : '<p class="text-muted">No events yet.</p>';
}

async function loadUsers() {
  const res = await api('/admin/users?limit=30');
  const users = res.users || [];
  document.getElementById('userList').innerHTML = users.length
    ? users.map(u => `
      <div class="glass" style="padding:16px;border-radius:14px;display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <div style="min-width:0;">
          <div style="font-weight:800;font-size:14px;">${escapeHtml(u.name)}</div>
          <div style="font-size:11px;color:var(--text-3);">${escapeHtml(u.email)}</div>
          <div style="font-size:11px;color:var(--text-3);">🎟️ ${u.bookings || 0} bookings • ${formatCurrency(u.spent || 0)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="color:#fca5a5;" onclick="delUser('${u._id}')">Delete</button>
      </div>`).join('')
    : '<p class="text-muted">No users yet.</p>';
}

async function loadBookings() {
  const res = await api('/admin/bookings?limit=20');
  const bookings = res.bookings || [];
  document.getElementById('bookingList').innerHTML = bookings.length
    ? bookings.map(b => `
      <div class="glass" style="padding:14px;border-radius:14px;margin-bottom:10px;font-size:13px;">
        <b>${escapeHtml(b.user?.name || '—')}</b> booked <b>${escapeHtml(b.event?.title || '—')}</b>
        — ${b.seats} seat(s), ${formatCurrency(b.totalAmount)} via ${b.paymentMethod}
        <span class="badge ${b.status === 'Confirmed' ? 'badge-success' : 'badge-danger'}" style="float:right;">${b.status}</span>
      </div>`).join('')
    : '<p class="text-muted">No bookings yet.</p>';
}

function setupCreateForm() {
  const imageInput = document.getElementById('e_image_file');
  imageInput.addEventListener('change', uploadEventImage);

  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert('alert');
    const btn = document.getElementById('createBtn');
    setLoading(btn, true, 'Publishing...');

    const payload = {
      title: document.getElementById('e_title').value.trim(),
      category: document.getElementById('e_category').value,
      venue: document.getElementById('e_venue').value.trim(),
      city: document.getElementById('e_city').value.trim(),
      date: document.getElementById('e_date').value,
      time: document.getElementById('e_time').value.trim(),
      price: Number(document.getElementById('e_price').value),
      totalSeats: Number(document.getElementById('e_seats').value),
      image: document.getElementById('e_image').value.trim(),
      description: document.getElementById('e_description').value.trim()
    };

    const res = await api('/events', 'POST', payload);
    setLoading(btn, false);

    if (!res._ok) {
      showAlert('alert', res.msg || 'Failed to create event', 'error');
      return;
    }

    toast('Event published 🚀', 'success');
    showAlert('alert', 'Event created successfully!', 'success');
    e.target.reset();
    await loadEvents();
    await loadStats();
  });
}

async function uploadEventImage(e) {
  const file = e.currentTarget.files[0];
  if (!file) return;

  const status = document.getElementById('imageUploadStatus');
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
    status.textContent = 'Choose a JPG, PNG or WebP image no larger than 5 MB.';
    e.currentTarget.value = '';
    return;
  }

  status.textContent = 'Uploading image securely to AWS S3…';
  const signed = await api('/admin/uploads/presign', 'POST', {
    contentType: file.type,
    fileName: file.name,
    size: file.size
  });
  if (!signed._ok) {
    status.textContent = signed.msg || 'Could not prepare the image upload.';
    return;
  }

  try {
    const form = new FormData();
    Object.entries(signed.fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', file);
    const response = await fetch(signed.uploadUrl, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`S3 upload failed (${response.status}).`);
    document.getElementById('e_image').value = signed.imageUrl;
    status.textContent = 'Image uploaded. It will be attached when you publish the event.';
  } catch (error) {
    console.error('Event image upload failed:', error);
    status.textContent = error.message || 'Image upload failed. Please try again.';
  }
}

async function delEvent(id) {
  if (!confirm('Delete this event?')) return;
  const res = await api(`/events/${id}`, 'DELETE');
  if (res._ok) { toast('Event deleted', 'success'); await loadAll(); }
  else toast(res.msg || 'Delete failed', 'error');
}

async function delUser(id) {
  if (!confirm('Delete user and all their bookings?')) return;
  const res = await api(`/admin/users/${id}`, 'DELETE');
  if (res._ok) { toast('User deleted', 'success'); await loadAll(); }
  else toast(res.msg || 'Delete failed', 'error');
}