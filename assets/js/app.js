import { renderBookDetailView } from './book-detail.js';
import { loadLibrary } from './data.js';
import {
  renderAuthorsView,
  renderGenresView,
  renderHistoryView,
  renderHomeView,
  renderReadView,
  renderToReadView,
  renderWishlistView,
} from './library.js';
import {
  parseRoute,
  setActiveNav,
  setPageTitle,
  setupMobileNavigation,
} from './navigation.js';
import { renderSearchView } from './search.js';
import { bindCoverFallbacks, escapeHtml } from './utils.js';

const appState = {
  tbrQuery: '',
  tbrPickIndex: 0,
  tbrGenre: '',
  tbrFormat: '',
  tbrSort: 'recent-added',
  readQuery: '',
  readGenre: '',
  readAuthor: '',
  readYear: '',
  readRating: '',
  readSort: 'recent-added',
  readViewMode: 'grid',
  wishlistQuery: '',
  wishlistSort: 'recent-added',
  historyYear: null,
  searchQuery: '',
  searchStatus: '',
};

let currentLibrary = null;

function formatLastUpdated(isoString) {
  if (typeof isoString !== 'string' || !isoString.trim()) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return /^\d{4}-\d{2}-\d{2}/.test(isoString) ? isoString.slice(0, 10) : null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} · ${hh}:${min}`;
}

function updateFooterMeta(library) {
  const el = document.getElementById('footer-sync-meta');
  if (!el || !library) return;

  const formattedDateTime = formatLastUpdated(library.last_updated);
  el.textContent = formattedDateTime
    ? `Nurzam’s Library · Last updated ${formattedDateTime}`
    : 'Nurzam’s Library';
}

function renderErrorView(container, error, onRetry) {
  setPageTitle('Unable to Load Library');
  container.innerHTML = `
    <div class="container">
      <div class="error-state neo-card" role="alert">
        <h1 class="error-state-title">Library data is temporarily unavailable</h1>
        <p class="error-state-text">
          We couldn’t load the published catalogue right now (${escapeHtml(error?.message || 'Unexpected error')}).
        </p>
        <div style="margin-top: 1.25rem;">
          <button type="button" id="retry-load-btn" class="neo-btn neo-btn-blue">Try Again</button>
        </div>
      </div>
    </div>
  `;
  container.querySelector('#retry-load-btn')?.addEventListener('click', onRetry);
}

const DEFAULT_SEO_TITLE = 'Nurzam’s Library — Personal Book Catalogue & Journal';
const DEFAULT_SEO_DESCRIPTION =
  'Explore Nurzam’s Library: a personal library documenting books read, books to read, literary interests, reviews, and an ongoing reading journey.';

function setMetaContent(selector, value) {
  const el = document.querySelector(selector);
  if (el && value) {
    el.setAttribute('content', value);
  }
}

function updateSocialMeta(route, viewTitle) {
  const baseUrl = window.location.origin + window.location.pathname;
  const fullUrl = window.location.hash ? `${baseUrl}${window.location.hash}` : baseUrl;
  const defaultImage = new URL('./assets/images/og-preview.jpg', baseUrl).href;

  const canonical = document.getElementById('canonical-link');
  if (canonical) canonical.setAttribute('href', baseUrl);
  setMetaContent('meta[property="og:url"]', fullUrl);

  let title = viewTitle ? `${viewTitle} — Nurzam’s Library` : DEFAULT_SEO_TITLE;
  let description = DEFAULT_SEO_DESCRIPTION;
  let image = defaultImage;

  if (route.section === 'book' && currentLibrary) {
    const book = currentLibrary.books.find(
      (b) => b.slug === route.param || b.id === route.param
    );
    if (book) {
      title = `${book.title} by ${book.author} — Nurzam’s Library`;
      if (book.description) {
        description =
          book.description.length > 155
            ? `${book.description.slice(0, 152).trim()}…`
            : book.description;
      }
      if (book.cover_url && /^https?:\/\//i.test(book.cover_url)) {
        image = book.cover_url;
      }
    }
  }

  setMetaContent('meta[name="description"]', description);
  setMetaContent('meta[property="og:title"]', title);
  setMetaContent('meta[property="og:description"]', description);
  setMetaContent('meta[property="og:image"]', image);
  setMetaContent('meta[name="twitter:title"]', title);
  setMetaContent('meta[name="twitter:description"]', description);
  setMetaContent('meta[name="twitter:image"]', image);
}

function renderRoute(options = {}) {
  const main = document.getElementById('main-content');
  if (!main || !currentLibrary) return;

  const route = parseRoute(window.location.hash);
  setActiveNav(route.section);

  let view;
  switch (route.section) {
    case 'to-read':
      view = renderToReadView(currentLibrary, appState);
      break;
    case 'read':
      view = renderReadView(currentLibrary, appState);
      break;
    case 'wishlist':
      view = renderWishlistView(currentLibrary, appState);
      break;
    case 'genres':
      view = renderGenresView(currentLibrary, route.param);
      break;
    case 'authors':
      view = renderAuthorsView(currentLibrary, route.param);
      break;
    case 'history':
      view = renderHistoryView(currentLibrary, appState);
      break;
    case 'search':
      view = renderSearchView(currentLibrary, appState);
      break;
    case 'book':
      view = renderBookDetailView(currentLibrary, route.param);
      break;
    case 'home':
    default:
      view = renderHomeView(currentLibrary);
      break;
  }

  setPageTitle(view.title);
  updateSocialMeta(route, view.title);
  main.innerHTML = view.html;
  bindCoverFallbacks(main);

  const onStateChange = (patch, mountOptions = {}) => {
    Object.assign(appState, patch);
    renderRoute(mountOptions);
  };

  if (typeof view.mount === 'function') {
    view.mount(main, onStateChange);
  }

  if (options.preserveInputFocus) {
    const target = main.querySelector(options.focusSelector || '#global-search-input');
    if (target) {
      target.focus();
      const len = target.value.length;
      if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(len, len);
      }
    }
  } else if (options.scrollToTop !== false) {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

async function init({ forceRefresh = false } = {}) {
  const main = document.getElementById('main-content');
  try {
    currentLibrary = await loadLibrary({ forceRefresh });
    updateFooterMeta(currentLibrary);
    renderRoute({ scrollToTop: false });
  } catch (error) {
    if (main) {
      renderErrorView(main, error, () => init({ forceRefresh: true }));
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupMobileNavigation();

  // Keyboard shortcut: "/" jumps to Search when not typing in an input
  document.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
    ) {
      event.preventDefault();
      window.location.hash = '#/search';
    }
  });

  window.addEventListener('hashchange', () => {
    renderRoute({ scrollToTop: true });
  });

  init();
});
