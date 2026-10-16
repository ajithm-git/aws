// ============================================================
//  Dashboard Logic
//  Path: event-booking/frontend/js/dashboard.js
// ============================================================

let dashState = {
  all: [],
  upcoming: [],
  past: [],
  tab: 'upcoming'
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  await Promise.all([loadStats(), loadBookings()]);
});

async function loadStats() {
  const res = await api('/bookings/stats/me');
  if (!res || res._ok === false) return;

  document.getElementById('stats').innerHTML = `
    ${statCard('🎟️', 'Total Bookings', res.totalBookings || 0)}
    ${statCard('✅', 'Confirmed', res.confirmed || 0)}
    ${statCard('💺', 'Seats Booked', res.totalSeats || 0)}
    ${statCard('💰', 'Amount paid', formatCurrency(res.totalSpent || 0))}
  `;
}

function statCard(icon, label, value) {
  return `
    <div class="stat-card">
      <div class="stat-icon">${icon}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>
  `;
}

async function loadBookings() {
  const res = await api('/bookings/my');
  if (!res || res._ok === false) return;

  dashState.all = res.all || [];
  dashState.upcoming = res.upcoming || [];
  dashState.past = res.past || [];

  renderList();
}

function switchTab(tab) {
  dashState.tab = tab;
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.tab === tab);
  });
  renderList();
}

function renderList() {
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');

  let items = [];
  if (dashState.tab === 'upcoming') {
    items = dashState.upcoming.filter(b => b.status === 'Confirmed');
  } else if (dashState.tab === 'past') {
    items = dashState.past;
  } else {
    items = dashState.all.filter(b => b.status === 'Cancelled');
  }

  if (!items.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = items.map(b => bookingCard(b)).join('');
}

function bookingCard(b) {
  const e = b.event || {};
  const isCancelled = b.status === 'Cancelled';
  const isPast = e.date && new Date(e.date).getTime() < Date.now();

  const statusClass =
    b.status === 'Confirmed' ? 'badge-success' :
    b.status === 'Cancelled' ? 'badge-danger' :
    'badge-info';

  return `
    <div class="glass fade-in-up" style="padding:20px;border-radius:18px;display:flex;gap:16px;">
      <img src="${escapeHtml(e.image || 'assets/event-placeholder.svg')}"
           style="width:100px;height:100px;border-radius:14px;object-fit:cover;flex-shrink:0;"
           onerror="this.src='assets/event-placeholder.svg'">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <h3 style="font-size:16px;font-weight:800;margin-bottom:4px;">${escapeHtml(e.title || 'Event deleted')}</h3>
          <span class="badge ${statusClass}">${b.status}</span>
        </div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:6px;">
          📍 ${escapeHtml(e.venue || 'N/A')}<br>
          📅 ${formatDate(e.date)}
        </div>
        <div class="mono" style="font-size:11px;color:var(--violet-400);margin-bottom:8px;">${b.bookingRef || ''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;color:var(--text-3);">💺 ${b.seats} • ${b.paymentMethod}</span>
          <span style="font-size:16px;font-weight:900;color:var(--violet-400);">${formatCurrency(b.totalAmount)}</span>
        </div>
        ${!isCancelled && !isPast
          ? `<button class="btn btn-ghost btn-sm" style="color:#fca5a5;margin-top:8px;padding-left:0;"
                     onclick="cancelBooking('${b._id}')">Cancel booking</button>`
          : ''}
      </div>
    </div>
  `;
}

async function cancelBooking(id) {
  if (!confirm('Cancel this reservation? This demo does not process payments or issue refunds.')) return;
  const res = await api(`/bookings/cancel/${id}`, 'PUT', { reason: 'User cancelled' });
  if (!res._ok) {
    toast(res.msg || 'Cancel failed', 'error');
    return;
  }
  toast('Booking cancelled', 'success');
  await Promise.all([loadStats(), loadBookings()]);
}