// ============================================================
//  Event Detail Page Logic
//  Path: event-booking/frontend/js/event.js
// ============================================================

document.addEventListener('DOMContentLoaded', loadEventDetail);

async function loadEventDetail() {
  const id = getQuery('id');
  if (!id) {
    toast('Event not found', 'error');
    setTimeout(() => location.href = 'index.html', 800);
    return;
  }

  const res = await api(`/events/${id}`);
  if (!res._ok || !res._id) {
    toast('Event not found', 'error');
    setTimeout(() => location.href = 'index.html', 800);
    return;
  }

  renderEvent(res);
}

function renderEvent(e) {
  const seatsLeft = (e.totalSeats || 0) - (e.bookedSeats || 0);
  const soldOut = seatsLeft <= 0;
  const isPast = new Date(e.date).getTime() < Date.now();

  document.getElementById('skeleton').classList.add('hidden');
  const content = document.getElementById('content');
  content.classList.remove('hidden');

  content.innerHTML = `
    <div class="fade-in-up">
      <img src="${escapeHtml(e.image)}" alt="${escapeHtml(e.title)}"
           style="width:100%;height:clamp(240px,40vw,440px);object-fit:cover;border-radius:24px;"
           onerror="this.src='assets/event-placeholder.svg'">
    </div>

    <div class="glass-strong fade-in-up" style="margin-top:-70px;position:relative;padding:32px;border-radius:24px;">
      <span class="badge badge-violet" style="margin-bottom:12px;">${escapeHtml(e.category || 'Event')}</span>
      <h1 style="font-size:clamp(1.6rem,4vw,2.6rem);margin-bottom:14px;">${escapeHtml(e.title)}</h1>

      <div class="flex flex-wrap gap-4" style="color:var(--text-3);font-size:14px;margin-bottom:22px;">
        <span>📍 ${escapeHtml(e.venue)}${e.city ? ', ' + escapeHtml(e.city) : ''}</span>
        <span>📅 ${formatDate(e.date)}</span>
        ${e.time ? `<span>🕒 ${escapeHtml(e.time)}</span>` : ''}
        <span>👥 ${e.bookingsCount || 0} going</span>
      </div>

      <p style="color:var(--text-2);line-height:1.7;margin-bottom:28px;">
        ${escapeHtml(e.description || 'No description provided.')}
      </p>

      <div class="grid grid-4" style="margin-bottom:28px;">
        <div class="stat-card">
          <div class="stat-label">Price</div>
          <div class="stat-value" style="font-size:22px;">${formatCurrency(e.price)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total seats</div>
          <div class="stat-value" style="font-size:22px;">${e.totalSeats}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Booked</div>
          <div class="stat-value" style="font-size:22px;">${e.bookedSeats}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Available</div>
          <div class="stat-value" style="font-size:22px;${seatsLeft < 10 ? 'color:#fca5a5' : ''}">${seatsLeft}</div>
        </div>
      </div>

      <div class="flex justify-between items-center flex-wrap gap-4">
        <div>
          <div style="font-size:12px;color:var(--text-4);letter-spacing:0.06em;text-transform:uppercase;">Total for 1 seat</div>
          <div style="font-size:32px;font-weight:900;" class="text-gradient">${formatCurrency(e.price)}</div>
        </div>

        ${isPast
          ? `<button class="btn btn-secondary btn-lg" disabled>Event Ended</button>`
          : soldOut
            ? `<button class="btn btn-secondary btn-lg" disabled>Sold Out</button>`
            : `<button class="btn btn-primary btn-lg" onclick="book('${e._id}')">Book Now →</button>`}
      </div>
    </div>
  `;
}

function book(id) {
  if (!isLoggedIn()) {
    toast('Please login to book', 'warning');
    setTimeout(() => location.href = `login.html?redirect=${encodeURIComponent('booking.html?id=' + id)}`, 700);
    return;
  }
  location.href = `booking.html?id=${id}`;
}