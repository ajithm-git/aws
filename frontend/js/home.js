// ============================================================
//  Home Page Logic — Carousel + Grid + Filters
//  Path: event-booking/frontend/js/home.js
//  Depends on: js/api.js
// ============================================================

// ============================================================
//  1. STATE
// ============================================================
const homeState = {
  allEvents: [],
  filtered: [],
  featured: [],
  categories: [],
  carouselIdx: 0,
  carouselTimer: null,
  page: 1,
  limit: 12,
  totalPages: 1,
  filters: {
    category: 'All',
    search: '',
    sort: 'date'
  }
};

// ============================================================
//  2. INITIAL LOAD
// ============================================================
async function initHome() {
  // Check if admin logged in → show admin link
  renderNavbar('index.html');

  // Load featured + categories in parallel
  await Promise.all([
    loadFeatured(),
    loadCategories(),
    loadEvents(true)
  ]);
}

// ============================================================
//  3. FEATURED / CAROUSEL
// ============================================================
async function loadFeatured() {
  const skeleton = document.getElementById('carouselSkeleton');
  const wrap = document.getElementById('carouselWrap');

  try {
    const data = await api('/events/featured');
    const events = Array.isArray(data) ? data : (data.events || []);

    if (!events.length) {
      skeleton.style.display = 'none';
      wrap.style.display = 'none';
      return;
    }

    homeState.featured = events;
    renderCarousel();
    renderCarouselDots();

    skeleton.style.display = 'none';
    wrap.style.display = 'block';
    startCarouselAutoplay();
  } catch (err) {
    console.error('Featured load error:', err);
    skeleton.style.display = 'none';
  }
}

function renderCarousel() {
  const track = document.getElementById('carouselTrack');
  track.innerHTML = homeState.featured.map((e, i) => `
    <div class="carousel-slide ${i === 0 ? 'active' : ''}" data-idx="${i}" onclick="openEvent('${e._id}')">
      <img src="${escapeHtml(e.image)}" alt="${escapeHtml(e.title)}" loading="${i === 0 ? 'eager' : 'lazy'}">
      <div class="carousel-overlay">
        <span class="carousel-category">${escapeHtml(e.category || 'Event')}</span>
        <h2 class="carousel-title">${escapeHtml(e.title)}</h2>
        <div class="carousel-meta">
          <span>📍 ${escapeHtml(e.venue)}</span>
          <span>📅 ${formatDate(e.date)}</span>
          <span>💺 ${e.totalSeats - e.bookedSeats} seats left</span>
        </div>
        <div class="carousel-actions">
          <button class="btn btn-primary" onclick="event.stopPropagation();openEvent('${e._id}')">
            Book Now →
          </button>
          <span class="btn btn-secondary" style="cursor:default;">
            ${formatCurrency(e.price)} / seat
          </span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderCarouselDots() {
  const dots = document.getElementById('carouselDots');
  dots.innerHTML = homeState.featured.map((_, i) => `
    <button class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="goToCarousel(${i})" aria-label="Go to slide ${i + 1}"></button>
  `).join('');
}

function goToCarousel(idx) {
  const total = homeState.featured.length;
  if (total === 0) return;

  homeState.carouselIdx = ((idx % total) + total) % total;

  const track = document.getElementById('carouselTrack');
  track.style.transform = `translateX(-${homeState.carouselIdx * 100}%)`;

  // Update slides
  document.querySelectorAll('.carousel-slide').forEach((s, i) => {
    s.classList.toggle('active', i === homeState.carouselIdx);
  });

  // Update dots
  document.querySelectorAll('.carousel-dot').forEach((d, i) => {
    d.classList.toggle('active', i === homeState.carouselIdx);
  });

  startCarouselAutoplay();
}

function slideCarousel(dir) {
  goToCarousel(homeState.carouselIdx + dir);
}

function startCarouselAutoplay() {
  clearInterval(homeState.carouselTimer);
  homeState.carouselTimer = setInterval(() => {
    goToCarousel(homeState.carouselIdx + 1);
  }, 5000);
}

// Pause on hover
document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.getElementById('carouselWrap');
  if (wrap) {
    wrap.addEventListener('mouseenter', () => clearInterval(homeState.carouselTimer));
    wrap.addEventListener('mouseleave', startCarouselAutoplay);
  }
});

function openEvent(id) {
  location.href = `event.html?id=${id}`;
}

// ============================================================
//  4. CATEGORIES
// ============================================================
async function loadCategories() {
  try {
    const data = await api('/events/categories');
    const list = Array.isArray(data) ? data : [];

    const chips = [
      { category: 'All', count: homeState.totalPages * 1000 },
      ...list
    ];

    document.getElementById('categoryChips').innerHTML = chips.map(c => `
      <button class="chip ${c.category === homeState.filters.category ? 'active' : ''}"
              data-cat="${c.category}"
              onclick="filterByCategory('${c.category}')">
        ${c.category === 'All' ? '✨ All Events' : escapeHtml(c.category)}
        ${c.count ? `<span style="opacity:0.6;font-size:11px;margin-left:4px;">${c.count}</span>` : ''}
      </button>
    `).join('');
  } catch (err) {
    console.error('Categories load error:', err);
  }
}

function filterByCategory(cat) {
  homeState.filters.category = cat;
  homeState.page = 1;

  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.cat === cat);
  });

  loadEvents(true);
}

// ============================================================
//  5. SEARCH & SORT
// ============================================================
function setupSearchAndSort() {
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');

  const debouncedSearch = debounce((value) => {
    homeState.filters.search = value.trim();
    homeState.page = 1;
    loadEvents(true);
  }, 400);

  searchInput?.addEventListener('input', (e) => debouncedSearch(e.target.value));

  sortSelect?.addEventListener('change', (e) => {
    homeState.filters.sort = e.target.value;
    homeState.page = 1;
    loadEvents(true);
  });
}

// ============================================================
//  6. LOAD EVENTS FROM API
// ============================================================
async function loadEvents(reset = false) {
  const grid = document.getElementById('eventGrid');
  const skeleton = document.getElementById('gridSkeleton');
  const empty = document.getElementById('emptyState');
  const errorState = document.getElementById('loadErrorState');
  const loadMoreWrap = document.getElementById('loadMoreWrap');

  if (reset) {
    homeState.page = 1;
    homeState.allEvents = [];
    grid.innerHTML = '';
    skeleton.style.display = 'grid';
    empty.classList.add('hidden');
    errorState.classList.remove('show');
    loadMoreWrap.classList.add('hidden');
  }

  // Build query
  const params = new URLSearchParams({
    sort: homeState.filters.sort,
    page: homeState.page,
    limit: homeState.limit
  });

  if (homeState.filters.category !== 'All') {
    params.append('category', homeState.filters.category);
  }
  if (homeState.filters.search) {
    params.append('search', homeState.filters.search);
  }

  try {
    const data = await api(`/events?${params.toString()}`);
    if (!data._ok) {
      skeleton.style.display = 'none';
      errorState.classList.add('show');
      document.getElementById('eventCount').textContent = 'Events are temporarily unavailable';
      return;
    }
    const events = data.events || [];
    const total = data.total || 0;
    const pages = data.pages || 1;

    homeState.allEvents = [...homeState.allEvents, ...events];
    homeState.totalPages = pages;

    skeleton.style.display = 'none';

    // Count text
    document.getElementById('eventCount').textContent =
      `${total} event${total === 1 ? '' : 's'} found`;

    // Append cards
    if (events.length) {
      events.forEach((e, i) => {
        grid.insertAdjacentHTML('beforeend', eventCardHTML(e, i));
      });
    }

    // Empty state
    if (homeState.allEvents.length === 0) {
      empty.classList.remove('hidden');
      loadMoreWrap.classList.add('hidden');
    } else if (homeState.page < pages) {
      loadMoreWrap.classList.remove('hidden');
    } else {
      loadMoreWrap.classList.add('hidden');
    }
  } catch (err) {
    console.error('Load events error:', err);
    skeleton.style.display = 'none';
    errorState.classList.add('show');
    document.getElementById('eventCount').textContent = 'Events are temporarily unavailable';
  }
}

// ============================================================
//  7. EVENT CARD HTML
// ============================================================
function eventCardHTML(e, i = 0) {
  const seatsLeft = (e.totalSeats || 0) - (e.bookedSeats || 0);
  const soldOut = seatsLeft <= 0;
  const urgent = seatsLeft > 0 && seatsLeft <= 10;
  const soon = e.date && new Date(e.date).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;

  let badgeHTML = '';
  if (soldOut) {
    badgeHTML = `<div class="event-badge soldout">Sold Out</div>`;
  } else if (urgent) {
    badgeHTML = `<div class="event-badge urgent">Only ${seatsLeft} left</div>`;
  } else if (soon) {
    badgeHTML = `<div class="event-badge">This Week</div>`;
  } else if (e.category) {
    badgeHTML = `<div class="event-badge">${escapeHtml(e.category)}</div>`;
  }

  let seatClass = 'event-seats';
  if (soldOut) seatClass += ' danger';
  else if (urgent) seatClass += ' warn';

  return `
    <article class="event-card fade-in-up" style="animation-delay:${Math.min(i * 40, 400)}ms"
             onclick="openEvent('${e._id}')">
      <div class="event-card-img">
        <img src="${escapeHtml(e.image)}" alt="${escapeHtml(e.title)}" loading="lazy"
             onerror="this.src='assets/event-placeholder.svg'">
        ${badgeHTML}
        <button class="event-fav" onclick="event.stopPropagation();toggleFav('${e._id}')" aria-label="Favourite">♡</button>
      </div>

      <div class="event-card-body">
        <h3 class="event-card-title">${escapeHtml(e.title)}</h3>
        <div class="event-meta">📍 ${escapeHtml(e.venue || 'TBA')}</div>
        <div class="event-meta">📅 ${formatDate(e.date)}${e.time ? ' • ' + escapeHtml(e.time) : ''}</div>

        <div class="event-card-footer">
          <div class="event-price">
            ${formatCurrency(e.price)}<small>/seat</small>
          </div>
          <div class="${seatClass}">
            ${soldOut ? 'Sold out' : seatsLeft + ' seats'}
          </div>
        </div>
      </div>
    </article>
  `;
}

// ============================================================
//  8. LOAD MORE
// ============================================================
function setupLoadMore() {
  const btn = document.getElementById('loadMoreBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (homeState.page >= homeState.totalPages) return;

    setLoading(btn, true, 'Loading...');
    homeState.page += 1;
    await loadEvents(false);
    setLoading(btn, false);
  });
}

// ============================================================
//  9. FAVOURITES (localStorage)
// ============================================================
function toggleFav(id) {
  const key = 'eb_favourites';
  const favs = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = favs.indexOf(id);

  if (idx === -1) {
    favs.push(id);
    toast('Added to favourites ♡', 'success', 1800);
  } else {
    favs.splice(idx, 1);
    toast('Removed from favourites', 'info', 1800);
  }
  localStorage.setItem(key, JSON.stringify(favs));
}

// ============================================================
//  10. BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initHome();
  setupSearchAndSort();
  setupLoadMore();

  // Keyboard arrow navigation for carousel
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') slideCarousel(-1);
    if (e.key === 'ArrowRight') slideCarousel(1);
  });
});