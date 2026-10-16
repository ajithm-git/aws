// ============================================================
//  Booking Page Logic
//  Path: event-booking/frontend/js/booking.js
// ============================================================

let bookingState = {
  event: null,
  method: 'Card',
  seats: 1
};

const PAY_METHODS = [
  { id: 'Card', label: '💳 Card' },
  { id: 'UPI', label: '📱 UPI' },
  { id: 'NetBanking', label: '🏦 NetBank' },
  { id: 'Wallet', label: '👛 Wallet' }
];

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  const id = getQuery('id');
  if (!id) {
    toast('No event selected', 'error');
    setTimeout(() => location.href = 'index.html', 700);
    return;
  }

  const res = await api(`/events/${id}`);
  if (!res._ok) {
    toast('Event not found', 'error');
    setTimeout(() => location.href = 'index.html', 700);
    return;
  }

  bookingState.event = res;
  renderSummary(res);
  renderPayMethods();
  setupForm();
  const seatsInput = document.getElementById('seats');
  const seatsAvailable = Math.max(0, res.totalSeats - res.bookedSeats);
  seatsInput.max = String(Math.min(10, seatsAvailable));
  if (seatsAvailable === 0) {
    seatsInput.disabled = true;
    document.getElementById('payBtn').disabled = true;
    showAlert('alert', 'This event has sold out. Choose another event.', 'error');
  }
  updateTotal();
});

function renderSummary(e) {
  document.getElementById('eventSummary').innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;">
      <img src="${escapeHtml(e.image)}" style="width:80px;height:80px;border-radius:12px;object-fit:cover;"
           onerror="this.src='assets/event-placeholder.svg'">
      <div style="flex:1;">
        <div style="font-weight:800;font-size:16px;margin-bottom:4px;">${escapeHtml(e.title)}</div>
        <div style="font-size:12px;color:var(--text-3);">📍 ${escapeHtml(e.venue)}</div>
        <div style="font-size:12px;color:var(--text-3);">📅 ${formatDate(e.date)}</div>
        <div style="font-size:13px;margin-top:6px;font-weight:700;color:var(--violet-400);">${formatCurrency(e.price)} / seat</div>
      </div>
    </div>
  `;
}

function renderPayMethods() {
  document.getElementById('payMethods').innerHTML = PAY_METHODS.map((m, i) => `
    <button type="button" data-m="${m.id}" class="pay-btn glass ${i === 0 ? 'active' : ''}"
            style="padding:14px 8px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;${i === 0 ? 'border-color:var(--violet-500);background:rgba(168,85,247,0.15);' : ''}">
      ${m.label}
    </button>
  `).join('');

  document.querySelectorAll('.pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bookingState.method = btn.dataset.m;
      document.querySelectorAll('.pay-btn').forEach(b => {
        b.classList.remove('active');
        b.style.borderColor = 'var(--glass-border)';
        b.style.background = 'var(--glass-bg)';
      });
      btn.classList.add('active');
      btn.style.borderColor = 'var(--violet-500)';
      btn.style.background = 'rgba(168,85,247,0.15)';
    });
  });
}

function setupForm() {
  const seatsInput = document.getElementById('seats');
  seatsInput.addEventListener('input', () => {
    const value = Number(seatsInput.value);
    bookingState.seats = Number.isInteger(value)
      ? Math.min(Math.max(value, 1), 10)
      : 1;
    updateTotal();
  });
  seatsInput.addEventListener('change', () => {
    seatsInput.value = String(bookingState.seats);
  });

  document.getElementById('bookingForm').addEventListener('submit', submitBooking);
}

function updateTotal() {
  const total = bookingState.seats * (bookingState.event?.price || 0);
  document.getElementById('totalAmount').textContent = formatCurrency(total);
}

async function submitBooking(e) {
  e.preventDefault();
  hideAlert('alert');

  if (!e.currentTarget.reportValidity()) return;

  const btn = document.getElementById('payBtn');
  setLoading(btn, true, 'Processing payment...');

  const payload = {
    eventId: bookingState.event._id,
    seats: bookingState.seats,
    paymentMethod: bookingState.method,
    notes: document.getElementById('notes').value.trim()
  };

  const res = await api('/bookings', 'POST', payload);

  if (!res._ok) {
    setLoading(btn, false);
    showAlert('alert', res.msg || 'Booking failed. Please try again.', 'error');
    toast(res.msg || 'Booking failed', 'error');
    return;
  }

  const confirmation = `${res.msg || 'Booking confirmed.'} Reference: ${res.booking.bookingRef}`;
  showAlert('alert', confirmation, 'success');
  toast(res.msg || 'Booking confirmed! Redirecting...', 'success');

  setTimeout(() => location.href = 'dashboard.html', 1400);
}