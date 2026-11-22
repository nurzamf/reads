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

function updateFooterMeta(library) {
  const el = document.getElementById('footer-sync-meta');
  if (!el || !library) return;

  const isoDate =
    typeof library.last_updated === 'string' && /^\d{4}-\d{2}-\d{2}/.test(library.last_updated)
      ? library.last_updated.slice(0, 10)
      : null;

  if (library.is_sample_data) {
    el.textContent = isoDate
      ? `Nurzam’s Library · Sample snapshot · Last updated ${isoDate}`
      : 'Nurzam’s Library · Sample snapshot';
  } else if (isoDate) {
    el.textContent = `Nurzam’s Library · Notion snapshot · Last updated ${isoDate}`;
  } else {
    el.textContent = 'Nurzam’s Library · Notion snapshot';
  }
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
