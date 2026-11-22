export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function slugify(value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  return cleaned
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function normalizeGenreKey(genre) {
  return normalizeWhitespace(genre).toLowerCase();
}

export function normalizeAuthorKey(author) {
  return normalizeWhitespace(author)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

export function toTitleCasePreserving(str) {
  const clean = normalizeWhitespace(str);
  if (!clean) return '';
  if (clean === clean.toLowerCase() || clean === clean.toUpperCase()) {
    return clean
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return clean;
}

export function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return false;
  const parsed = new Date(trimmed);
  return !Number.isNaN(parsed.getTime());
}

export function parseDateYear(dateStr) {
  if (!isValidDateString(dateStr)) return null;
  return Number.parseInt(dateStr.trim().slice(0, 4), 10);
}

export function parseDateMonthIndex(dateStr) {
  if (!isValidDateString(dateStr)) return null;
  const month = Number.parseInt(dateStr.trim().slice(5, 7), 10);
  if (month < 1 || month > 12) return null;
  return month - 1;
}

export function formatDate(dateStr) {
  if (!isValidDateString(dateStr)) return null;
  const date = new Date(`${dateStr.trim().slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatTimestamp(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return null;
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('./') || trimmed.startsWith('assets/')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function calculateProgress(currentPage, totalPages) {
  if (
    typeof currentPage !== 'number' ||
    typeof totalPages !== 'number' ||
    !Number.isFinite(currentPage) ||
    !Number.isFinite(totalPages) ||
    totalPages <= 0 ||
    currentPage < 0
  ) {
    return null;
  }
  const pct = (currentPage / totalPages) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function statusSlug(status) {
  return slugify(status || 'unknown');
}

export function renderStatusBadge(status) {
  const label = normalizeWhitespace(status) || 'Uncategorised';
  const slug = statusSlug(label);
  const icons = {
    read: '✓',
    reading: '◐',
    'to-be-read': '○',
    wishlist: '★',
    dnf: '×',
  };
  const symbol = icons[slug] || '•';
  return `<span class="status-label status-label--${escapeHtml(slug)}"><span aria-hidden="true">${symbol}</span><span>${escapeHtml(label)}</span></span>`;
}

export function renderRating(rating) {
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) {
    return '';
  }
  const rounded = Math.round(rating * 10) / 10;
  return `<span class="rating-display tabular-nums" aria-label="Rated ${escapeHtml(rounded)} out of 5"><span class="rating-star-icon" aria-hidden="true">★</span><span>${escapeHtml(rounded)}/5</span></span>`;
}

export function renderCoverMarkup(book, { eager = false, sizes = '' } = {}) {
  const title = escapeHtml(book.title || 'Untitled Book');
  const author = escapeHtml(book.author || 'Unknown Author');
  const hasCover = isSafeUrl(book.cover_url);
  const loadingAttr = eager ? 'eager' : 'lazy';

  const fallbackHtml = `
    <div class="cover-fallback" aria-hidden="${hasCover ? 'true' : 'false'}">
      <span class="cover-fallback-badge">BOOK</span>
      <div>
        <div class="cover-fallback-title">${title}</div>
        <div class="cover-fallback-author">${author}</div>
      </div>
    </div>
  `;

  if (!hasCover) {
    return `<div class="cover-frame">${fallbackHtml}</div>`;
  }

  return `
    <div class="cover-frame">
      <img
        class="cover-img"
        src="${escapeHtml(book.cover_url)}"
        alt="Cover of ${title} by ${author}"
        loading="${loadingAttr}"
        decoding="async"
        referrerpolicy="no-referrer"
        ${sizes ? `sizes="${escapeHtml(sizes)}"` : ''}
        data-fallback-cover="true"
      />
    </div>
  `;
}

export function bindCoverFallbacks(root = document) {
  const imgs = root.querySelectorAll('img[data-fallback-cover="true"]');
  imgs.forEach((img) => {
    if (img.dataset.boundFallback === '1') return;
    img.dataset.boundFallback = '1';
    img.addEventListener('error', () => {
      const frame = img.closest('.cover-frame');
      if (!frame) return;
      const altText = img.getAttribute('alt') || 'Book cover';
      const titleMatch = altText.replace(/^Cover of\s+/i, '').split(/\s+by\s+/i);
      const title = escapeHtml(titleMatch[0] || 'Untitled');
      const author = escapeHtml(titleMatch[1] || '');
      frame.innerHTML = `
        <div class="cover-fallback">
          <span class="cover-fallback-badge">BOOK</span>
          <div>
            <div class="cover-fallback-title">${title}</div>
            ${author ? `<div class="cover-fallback-author">${author}</div>` : ''}
          </div>
        </div>
      `;
    });
  });
}
