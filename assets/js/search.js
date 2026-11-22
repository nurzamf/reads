import { renderBookCard } from './book-detail.js';
import { bindCoverFallbacks, escapeHtml } from './utils.js';

export function performSearch(books, query, statusFilter = '') {
  const q = (query || '').trim().toLowerCase();
  return books.filter((book) => {
    if (statusFilter && book.status !== statusFilter) {
      return false;
    }
    if (!q) return false;

    const fields = [
      book.title,
      book.author,
      ...(book.genres || []),
      book.publisher || '',
      book.isbn || '',
      book.description || '',
    ];
    return fields.some((field) => String(field).toLowerCase().includes(q));
  });
}

export function renderSearchView(library, state) {
  const query = state.searchQuery || '';
  const statusFilter = state.searchStatus || '';
  const trimmed = query.trim();

  const matches = trimmed ? performSearch(library.books, trimmed, statusFilter) : [];

  const statuses = ['Reading', 'Read', 'To Be Read', 'Wishlist', 'DNF'];
  const statusCounts = statuses.filter((s) => library.books.some((b) => b.status === s));

  const resultsMarkup = !trimmed
    ? `
      <div class="empty-state neo-card">
        <h2 class="empty-state-title">Search the catalogue</h2>
        <p class="empty-state-text">
          Search across book titles, authors, genres, publishers, ISBN numbers, and descriptions.
        </p>
        <div style="margin-top: 1.25rem; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem;">
          <button type="button" class="neo-btn neo-btn-sm" data-quick-query="Science Fiction">Science Fiction</button>
          <button type="button" class="neo-btn neo-btn-sm" data-quick-query="Le Guin">Le Guin</button>
          <button type="button" class="neo-btn neo-btn-sm" data-quick-query="Essays">Essays</button>
        </div>
      </div>
    `
    : matches.length === 0
      ? `
        <div class="empty-state neo-card">
          <h2 class="empty-state-title">No matching books found</h2>
          <p class="empty-state-text">
            No books matched “${escapeHtml(trimmed)}”${statusFilter ? ` in ${escapeHtml(statusFilter)}` : ''}. Try a different keyword or clear your filters.
          </p>
        </div>
      `
      : `
        <div class="books-grid">
          ${matches.map((book) => renderBookCard(book)).join('')}
        </div>
      `;

  return {
    title: 'Search',
    html: `
      <div class="container">
        <header class="page-header">
          <div>
            <h1 class="page-title">Search Library</h1>
            <p class="page-description">Find books by title, author, genre, publisher, ISBN, or description.</p>
          </div>
          ${
            trimmed
              ? `<span class="page-count-badge tabular-nums" id="search-result-count">${escapeHtml(matches.length)} ${matches.length === 1 ? 'result' : 'results'}</span>`
              : ''
          }
        </header>

        <section class="search-bar-card" aria-label="Search controls">
          <label for="global-search-input" style="font-family: var(--font-display); font-weight: 800; font-size: 1.05rem;">
            Search Nurzam’s Library
          </label>
          <div class="search-input-row">
            <input
              id="global-search-input"
              type="search"
              class="neo-input"
              placeholder="Try a title, author, genre, ISBN, or topic…"
              value="${escapeHtml(query)}"
              autocomplete="off"
            />
            ${
              trimmed || statusFilter
                ? `<button type="button" id="search-clear-btn" class="neo-btn neo-btn-yellow">Clear</button>`
                : ''
            }
          </div>
          <div style="margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem;" role="group" aria-label="Filter search results by status">
            <button type="button" class="neo-btn neo-btn-sm ${statusFilter === '' ? 'neo-btn-yellow' : ''}" data-search-status="">All Shelves</button>
            ${statusCounts
              .map(
                (st) =>
                  `<button type="button" class="neo-btn neo-btn-sm ${statusFilter === st ? 'neo-btn-yellow' : ''}" data-search-status="${escapeHtml(st)}">${escapeHtml(st)}</button>`
              )
              .join('')}
          </div>
        </section>

        <div id="search-results-region" aria-live="polite">
          ${resultsMarkup}
        </div>
      </div>
    `,
    mount(container, onStateChange) {
      const input = container.querySelector('#global-search-input');
      const clearBtn = container.querySelector('#search-clear-btn');

      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);

        input.addEventListener('input', (e) => {
          onStateChange({ searchQuery: e.target.value }, { preserveInputFocus: true });
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          onStateChange({ searchQuery: '', searchStatus: '' });
        });
      }

      container.querySelectorAll('[data-search-status]').forEach((btn) => {
        btn.addEventListener('click', () => {
          onStateChange({ searchStatus: btn.getAttribute('data-search-status') || '' });
        });
      });

      container.querySelectorAll('[data-quick-query]').forEach((btn) => {
        btn.addEventListener('click', () => {
          onStateChange({ searchQuery: btn.getAttribute('data-quick-query') || '' });
        });
      });

      bindCoverFallbacks(container);
    },
  };
}
