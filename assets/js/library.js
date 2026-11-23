import {
  filterBooks,
  sortBooks,
} from './filters.js';
import { generateRecommendations } from './recommendations.js';
import {
  buildAuthorDirectory,
  buildGenreDirectory,
  computeCollectionStats,
  computeYearStats,
  getReadingYears,
  isCompletedBook,
  isDnfBook,
  isReadingBook,
  isToReadBook,
  isWishlistBook,
} from './statistics.js';
import {
  bindCoverFallbacks,
  calculateProgress,
  escapeHtml,
  formatDate,
  renderCoverMarkup,
  renderRating,
  renderStatusBadge,
  slugify,
} from './utils.js';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SINGLE = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const DEFAULT_ANNUAL_READING_GOAL = 26;

function renderCoralStars(rating) {
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) {
    return '';
  }
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped);
  const hasHalf = clamped - full >= 0.25 && clamped - full < 0.75;
  const roundedUp = clamped - full >= 0.75 ? full + 1 : full;
  const empty = Math.max(0, 5 - roundedUp - (hasHalf ? 1 : 0));

  let starsHtml = '';
  for (let i = 0; i < roundedUp; i += 1) {
    starsHtml += '<span class="star-full" aria-hidden="true">★</span>';
  }
  if (hasHalf) {
    starsHtml += '<span class="star-half" aria-hidden="true">½</span>';
  }
  for (let i = 0; i < empty; i += 1) {
    starsHtml += '<span class="star-empty" aria-hidden="true">☆</span>';
  }

  return `<div class="home-shelf-stars" aria-label="Rated ${escapeHtml(clamped)} out of 5">${starsHtml}</div>`;
}

function renderHomeShelfCard(book, { showRating = false } = {}) {
  const authorSlug = slugify(book.author);
  return `
    <article class="home-shelf-item">
      <a
        href="#/book/${encodeURIComponent(book.slug)}"
        class="home-shelf-cover-link"
        aria-label="View details for ${escapeHtml(book.title)} by ${escapeHtml(book.author)}"
      >
        ${renderCoverMarkup(book)}
      </a>
      <h3 class="home-shelf-title">
        <a href="#/book/${encodeURIComponent(book.slug)}">${escapeHtml(book.title)}</a>
      </h3>
      <p class="home-shelf-author">
        <a href="#/authors/${encodeURIComponent(authorSlug)}">${escapeHtml(book.author)}</a>
      </p>
      ${showRating ? renderCoralStars(book.rating) : ''}
    </article>
  `;
}

function renderCurrentlyReadingCard(book) {
  const progress = calculateProgress(book.current_page, book.pages);
  const authorSlug = slugify(book.author);

  return `
    <article class="neo-card reading-card">
      <a href="#/book/${encodeURIComponent(book.slug)}" aria-label="View details for ${escapeHtml(book.title)}">
        ${renderCoverMarkup(book, { eager: true })}
      </a>
      <div class="reading-card-body">
        ${renderStatusBadge(book.status)}
        <h3 class="book-card-title" style="font-size: 1.25rem; margin-top: 0.25rem;">
          <a href="#/book/${encodeURIComponent(book.slug)}">${escapeHtml(book.title)}</a>
        </h3>
        <p class="book-card-author">
          <a href="#/authors/${encodeURIComponent(authorSlug)}">${escapeHtml(book.author)}</a>
        </p>
        ${
          book.genres?.length
            ? `<p style="font-size: 0.85rem; color: var(--color-muted);">${escapeHtml(book.genres.join(' · '))}</p>`
            : ''
        }
        ${
          progress !== null
            ? `
          <div class="progress-wrap">
            <div class="progress-meta tabular-nums">
              <span>Page ${escapeHtml(book.current_page)} of ${escapeHtml(book.pages)}</span>
              <span>${escapeHtml(progress)}%</span>
            </div>
            <div class="progress-track" role="progressbar" aria-valuenow="${escapeHtml(progress)}" aria-valuemin="0" aria-valuemax="100" aria-label="Reading progress for ${escapeHtml(book.title)}: ${escapeHtml(progress)} percent">
              <div class="progress-fill" style="width: ${escapeHtml(progress)}%;"></div>
            </div>
          </div>
        `
            : book.pages
              ? `<p style="font-size: 0.85rem; color: var(--color-muted); margin-top: 0.4rem;" class="tabular-nums">${escapeHtml(book.pages)} pages · ${escapeHtml(book.format || 'Reading')}</p>`
              : ''
        }
      </div>
    </article>
  `;
}

export function renderHomeView(library) {
  const books = library.books;
  const stats = computeCollectionStats(books);
  const readingNow = books.filter(isReadingBook);
  const genres = buildGenreDirectory(books);
  const authors = buildAuthorDirectory(books);
  const years = getReadingYears(books);
  const latestYear = years[0] || new Date().getFullYear();
  const latestYearStats = years.length > 0 ? computeYearStats(books, latestYear) : null;

  const completedInGoalYear = latestYearStats ? latestYearStats.completedCount : stats.readCount;
  const goalPct = Math.min(100, Math.round((completedInGoalYear / DEFAULT_ANNUAL_READING_GOAL) * 100));

  // Hero 4-book fan: prioritise currently reading, favourites, then recent read books
  const heroShowcaseBooks = [
    ...readingNow,
    ...books.filter((b) => b.favourite && !isReadingBook(b)),
    ...books.filter((b) => isCompletedBook(b) && !b.favourite),
    ...books,
  ]
    .filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
    .slice(0, 4);

  // Featured: favourites first, otherwise highest rated read books
  const favourites = books.filter((b) => b.favourite);
  const featuredBooks =
    favourites.length > 0
      ? favourites.slice(0, 6)
      : [...books]
          .filter((b) => typeof b.rating === 'number' && b.rating >= 4)
          .sort((a, b) => (b.rating || 0) - (a.rating || 0))
          .slice(0, 6);

  // Recently added: 6 newest books
  const recentlyAdded = [...books]
    .sort((a, b) => {
      const d = (b.date_added || '').localeCompare(a.date_added || '');
      return d !== 0 ? d : a.title.localeCompare(b.title);
    })
    .slice(0, 6);

  const sampleBannerHtml = library.is_sample_data
    ? `
      <aside class="sample-banner" aria-label="Sample data notice">
        <strong>Sample Development Catalogue:</strong> ${escapeHtml(
          library.sample_notice ||
            'Showing placeholder sample books. Connect your Notion database to publish your live collection.'
        )}
      </aside>
    `
    : '';

  const avgRatingText =
    stats.averageRating !== null ? stats.averageRating.toFixed(1) : '—';

  const maxMonthCount = latestYearStats
    ? Math.max(1, ...latestYearStats.monthlyCounts)
    : 1;

  const html = `
    <div class="container">
      ${sampleBannerHtml}

      <section class="home-hero" aria-labelledby="hero-heading">
        <div class="home-hero-content">
          <h1 id="hero-heading" class="home-hero-title">Nurzam’s Library</h1>
          <p class="home-hero-lead">
            An evolving collection of stories, ideas, and worlds worth exploring.
          </p>

          <div class="hero-goal-card">
            <div class="hero-goal-title tabular-nums">${escapeHtml(latestYear)} reading goal</div>
            <div
              class="hero-goal-track"
              role="progressbar"
              aria-valuenow="${escapeHtml(goalPct)}"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="${escapeHtml(latestYear)} reading goal: ${escapeHtml(completedInGoalYear)} of ${escapeHtml(DEFAULT_ANNUAL_READING_GOAL)} books (${escapeHtml(goalPct)}%)"
            >
              <div class="hero-goal-fill" style="width: ${escapeHtml(goalPct)}%;"></div>
            </div>
            <div class="hero-goal-meta tabular-nums">
              ${escapeHtml(completedInGoalYear)} of ${escapeHtml(DEFAULT_ANNUAL_READING_GOAL)} books · ${escapeHtml(goalPct)}%
            </div>
          </div>

          <div class="home-hero-cta">
            <a href="#/read" class="neo-btn neo-btn-yellow">Browse the library</a>
          </div>
        </div>

        ${
          heroShowcaseBooks.length > 0
            ? `
          <div class="hero-fan-stack" aria-label="Featured book stack">
            ${heroShowcaseBooks
              .map(
                (book, idx) => `
              <a
                href="#/book/${encodeURIComponent(book.slug)}"
                class="hero-fan-card hero-fan-card--${idx + 1}"
                aria-label="${escapeHtml(book.title)} by ${escapeHtml(book.author)}"
              >
                ${renderCoverMarkup(book, { eager: true })}
              </a>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </section>

      <section class="home-section" aria-labelledby="numbers-heading">
        <h2 id="numbers-heading" class="home-section-heading">The numbers</h2>
        <div class="home-stats-grid">
          <div class="home-stat-card home-stat-card--white">
            <span class="home-stat-value tabular-nums">${escapeHtml(stats.totalBooks)}</span>
            <span class="home-stat-label">TOTAL</span>
          </div>
          <div class="home-stat-card home-stat-card--soft">
            <span class="home-stat-value tabular-nums">${escapeHtml(stats.readCount)}</span>
            <span class="home-stat-label">READ</span>
          </div>
          <div class="home-stat-card home-stat-card--yellow">
            <span class="home-stat-value tabular-nums">${escapeHtml(stats.readingCount)}</span>
            <span class="home-stat-label">READING</span>
          </div>
          <div class="home-stat-card home-stat-card--soft">
            <span class="home-stat-value tabular-nums">${escapeHtml(stats.toReadCount)}</span>
            <span class="home-stat-label">TO READ</span>
          </div>
          <div class="home-stat-card home-stat-card--white">
            <span class="home-stat-value tabular-nums">${escapeHtml(stats.wishlistCount)}</span>
            <span class="home-stat-label">WISHLIST</span>
          </div>
          <div class="home-stat-card home-stat-card--yellow">
            <span class="home-stat-value tabular-nums">${escapeHtml(avgRatingText)}</span>
            <span class="home-stat-label">AVG RATING</span>
          </div>
        </div>
      </section>

      <section class="home-section" aria-labelledby="currently-reading-heading">
        <h2 id="currently-reading-heading" class="home-section-heading">Currently reading</h2>
        ${
          readingNow.length > 0
            ? `<div class="reading-grid">${readingNow.map(renderCurrentlyReadingCard).join('')}</div>`
            : `<div class="nightstand-empty">Nothing on the nightstand right now.</div>`
        }
      </section>

      ${
        featuredBooks.length > 0
          ? `
        <section class="home-section" aria-labelledby="featured-heading">
          <h2 id="featured-heading" class="home-section-heading">Featured</h2>
          <div class="home-shelf-grid">
            ${featuredBooks.map((book) => renderHomeShelfCard(book, { showRating: true })).join('')}
          </div>
        </section>
      `
          : ''
      }

      ${
        recentlyAdded.length > 0
          ? `
        <section class="home-section" aria-labelledby="recent-added-heading">
          <h2 id="recent-added-heading" class="home-section-heading">Recently added</h2>
          <div class="home-shelf-grid">
            ${recentlyAdded.map((book) => renderHomeShelfCard(book)).join('')}
          </div>
        </section>
      `
          : ''
      }

      ${
        authors.length > 0
          ? `
        <section class="home-section" aria-labelledby="browse-author-heading">
          <h2 id="browse-author-heading" class="home-section-heading">Browse by author</h2>
          <div class="author-pills-wrap">
            ${authors
              .slice(0, 10)
              .map(
                (author) => `
              <a href="#/authors/${encodeURIComponent(author.slug)}" class="author-pill-btn">
                <span>${escapeHtml(author.name.toUpperCase())} · <span class="tabular-nums">${escapeHtml(author.count)}</span></span>
              </a>
            `
              )
              .join('')}
          </div>
        </section>
      `
          : ''
      }

      ${
        genres.length > 0
          ? `
        <section class="home-section" aria-labelledby="browse-genres-heading">
          <h2 id="browse-genres-heading" class="home-section-heading">Browse by genre</h2>
          <div class="author-pills-wrap">
            ${genres
              .slice(0, 10)
              .map(
                (genre) => `
              <a href="#/genres/${encodeURIComponent(genre.slug)}" class="author-pill-btn">
                <span>${escapeHtml(genre.name.toUpperCase())} · <span class="tabular-nums">${escapeHtml(genre.count)}</span></span>
              </a>
            `
              )
              .join('')}
          </div>
        </section>
      `
          : ''
      }

      ${
        latestYearStats
          ? `
        <section class="home-section" aria-labelledby="activity-overview-heading">
          <h2 id="activity-overview-heading" class="home-section-heading">Reading activity ${escapeHtml(latestYear)}</h2>
          <a href="#/history" class="home-activity-card" aria-label="View full ${escapeHtml(latestYear)} reading history">
            <div class="home-month-bars" role="img" aria-label="Monthly completions in ${escapeHtml(latestYear)}">
              ${latestYearStats.monthlyCounts
                .map((count, idx) => {
                  const heightPct = count > 0 ? Math.max(18, Math.round((count / maxMonthCount) * 100)) : 0;
                  return `
                    <div class="home-month-col">
                      <div class="home-month-bar-slot">
                        ${
                          count > 0
                            ? `<div class="home-month-bar" style="height: ${heightPct}%;" title="${MONTHS_SHORT[idx]}: ${count} ${count === 1 ? 'book' : 'books'}"></div>`
                            : `<div class="home-month-zero" title="${MONTHS_SHORT[idx]}: 0 books"></div>`
                        }
                      </div>
                      <span class="home-month-label">${MONTHS_SINGLE[idx]}</span>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </a>
        </section>
      `
          : ''
      }

      <section class="home-section" aria-labelledby="explore-library-heading">
        <h2 id="explore-library-heading" class="home-section-heading">Explore</h2>
        <div class="home-explore-grid">
          <a href="#/to-read" class="home-explore-btn home-explore-btn--yellow">To Read <span aria-hidden="true">→</span></a>
          <a href="#/read" class="home-explore-btn home-explore-btn--coral">Read <span aria-hidden="true">→</span></a>
          <a href="#/wishlist" class="home-explore-btn home-explore-btn--soft-blue">Wishlist <span aria-hidden="true">→</span></a>
          <a href="#/genres" class="home-explore-btn home-explore-btn--mint">Genre <span aria-hidden="true">→</span></a>
          <a href="#/authors" class="home-explore-btn home-explore-btn--pink">Author <span aria-hidden="true">→</span></a>
          <a href="#/history" class="home-explore-btn home-explore-btn--lavender">History <span aria-hidden="true">→</span></a>
          <a href="#/search" class="home-explore-btn home-explore-btn--yellow">Search <span aria-hidden="true">→</span></a>
        </div>
      </section>
    </div>
  `;

  return {
    title: '',
    html,
  };
}

export function renderToReadView(library, state) {
  const allToRead = library.books.filter(isToReadBook);
  const recResult = generateRecommendations(library.books, {
    maxRecommendations: Math.max(4, allToRead.length),
  });
  const recommendations = recResult.recommendations || [];
  const rawPickIndex = Number.isInteger(state.tbrPickIndex) ? state.tbrPickIndex : 0;
  const pickIndex = recommendations.length > 0 ? rawPickIndex % recommendations.length : 0;
  const currentPick = recommendations[pickIndex] || null;

  const criteria = {
    query: state.tbrQuery || '',
  };
  const sortBy = state.tbrSort || 'recent-added';
  const filtered = sortBooks(filterBooks(allToRead, criteria), sortBy);

  const html = `
    <div class="container">
      <header class="tbr-page-header">
        <h1 class="tbr-page-title">To Read</h1>
        <p class="tbr-page-subtitle">What’s waiting on the shelf.</p>
      </header>

      <section class="tbr-featured-card" aria-labelledby="curated-next-heading">
        <div class="tbr-featured-info">
          <span class="tbr-curated-badge">✦ CURATED PICK</span>
          <h2 id="curated-next-heading" class="tbr-featured-title">Your next read</h2>
          <p class="tbr-featured-lead">
            Picked from your ratings, favourite authors and a bit of variety. It gets sharper once genres and page counts are in the database.
          </p>
          <div class="tbr-featured-cta">
            <button
              type="button"
              id="tbr-another-btn"
              class="neo-btn neo-btn-yellow"
              ${recommendations.length <= 1 ? 'disabled' : ''}
            >
              Show me another
            </button>
          </div>
          <p class="tbr-featured-note">
            Scored by a transparent rule-based model, no external AI service.
          </p>
        </div>

        ${
          currentPick
            ? `
          <div class="tbr-pick-card">
            <a
              href="#/book/${encodeURIComponent(currentPick.book.slug)}"
              class="tbr-pick-cover-link"
              aria-label="View details for ${escapeHtml(currentPick.book.title)} by ${escapeHtml(currentPick.book.author)}"
            >
              ${renderCoverMarkup(currentPick.book, { eager: true })}
            </a>
            <div class="tbr-pick-body">
              <h3 class="tbr-pick-title">
                <a href="#/book/${encodeURIComponent(currentPick.book.slug)}">${escapeHtml(currentPick.book.title)}</a>
              </h3>
              <p class="tbr-pick-author">
                <a href="#/authors/${encodeURIComponent(slugify(currentPick.book.author))}">${escapeHtml(currentPick.book.author)}</a>
              </p>
              <p class="tbr-pick-reason">${escapeHtml(currentPick.reason)}</p>
            </div>
          </div>
        `
            : `
          <div class="tbr-pick-card tbr-pick-card--empty">
            <p class="tbr-pick-reason">No To Be Read books are currently available to rank.</p>
          </div>
        `
        }
      </section>

      <section class="tbr-list-section" aria-labelledby="all-tbr-heading">
        <h2 id="all-tbr-heading" class="home-section-heading">All to read</h2>

        <div class="tbr-toolbar">
          <label for="tbr-search-input" class="sr-only">Search this list</label>
          <input
            id="tbr-search-input"
            type="search"
            class="neo-input tbr-search-input"
            placeholder="Search this list"
            value="${escapeHtml(criteria.query)}"
          />
          <label for="tbr-sort-select" class="sr-only">Sort To Read books</label>
          <select id="tbr-sort-select" class="neo-select tbr-sort-select">
            <option value="recent-added" ${sortBy === 'recent-added' ? 'selected' : ''}>Recently added</option>
            <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Title (A–Z)</option>
            <option value="author" ${sortBy === 'author' ? 'selected' : ''}>Author (A–Z)</option>
            <option value="rating-desc" ${sortBy === 'rating-desc' ? 'selected' : ''}>Rating</option>
            <option value="year-desc" ${sortBy === 'year-desc' ? 'selected' : ''}>Publication year</option>
          </select>
        </div>

        <p class="tbr-count-line">
          <strong class="tabular-nums">${escapeHtml(filtered.length)}</strong> ${filtered.length === 1 ? 'book' : 'books'}
        </p>

        ${
          filtered.length > 0
            ? `<div class="home-shelf-grid">${filtered.map((book) => renderHomeShelfCard(book)).join('')}</div>`
            : `<div class="empty-state neo-card"><h3 class="empty-state-title">No books match that search</h3><p class="empty-state-text">Try a different title or author, or clear your search query.</p></div>`
        }
      </section>
    </div>
  `;

  return {
    title: 'To Read',
    html,
    mount(container, onStateChange) {
      container.querySelector('#tbr-another-btn')?.addEventListener('click', () => {
        if (recommendations.length > 1) {
          onStateChange(
            { tbrPickIndex: (pickIndex + 1) % recommendations.length },
            { scrollToTop: false }
          );
        }
      });
      container.querySelector('#tbr-search-input')?.addEventListener('input', (e) => {
        onStateChange(
          { tbrQuery: e.target.value },
          {
            preserveInputFocus: true,
            focusSelector: '#tbr-search-input',
            scrollToTop: false,
          }
        );
      });
      container.querySelector('#tbr-sort-select')?.addEventListener('change', (e) => {
        onStateChange({ tbrSort: e.target.value }, { scrollToTop: false });
      });
      bindCoverFallbacks(container);
    },
  };
}

export function renderReadView(library, state) {
  const completedBooks = library.books.filter(isCompletedBook);
  const dnfBooks = library.books.filter(isDnfBook);

  const criteria = {
    query: state.readQuery || '',
  };
  const sortBy = state.readSort || 'recent-added';
  const filtered = sortBooks(filterBooks(completedBooks, criteria), sortBy);

  const html = `
    <div class="container">
      <header class="tbr-page-header">
        <h1 class="tbr-page-title">Read</h1>
        <p class="tbr-page-subtitle">Finished books, rated and remembered.</p>
      </header>

      <div class="tbr-toolbar">
        <label for="read-search-input" class="sr-only">Search this list</label>
        <input
          id="read-search-input"
          type="search"
          class="neo-input tbr-search-input"
          placeholder="Search this list"
          value="${escapeHtml(criteria.query)}"
        />
        <label for="read-sort-select" class="sr-only">Sort Read books</label>
        <select id="read-sort-select" class="neo-select tbr-sort-select">
          <option value="recent-added" ${sortBy === 'recent-added' ? 'selected' : ''}>Recently added</option>
          <option value="recent-finished" ${sortBy === 'recent-finished' ? 'selected' : ''}>Recently finished</option>
          <option value="rating-desc" ${sortBy === 'rating-desc' ? 'selected' : ''}>Highest rated</option>
          <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Title (A–Z)</option>
          <option value="author" ${sortBy === 'author' ? 'selected' : ''}>Author (A–Z)</option>
        </select>
      </div>

      <p class="tbr-count-line">
        <strong class="tabular-nums">${escapeHtml(filtered.length)}</strong> ${filtered.length === 1 ? 'book' : 'books'}
      </p>

      ${
        filtered.length > 0
          ? `<div class="home-shelf-grid">${filtered.map((book) => renderHomeShelfCard(book, { showRating: true })).join('')}</div>`
          : `<div class="empty-state neo-card"><h2 class="empty-state-title">No completed books match</h2><p class="empty-state-text">Try a different title or author, or clear your search query.</p></div>`
      }

      ${
        dnfBooks.length > 0
          ? `
        <section class="home-section" aria-labelledby="dnf-heading">
          <h2 id="dnf-heading" class="home-section-heading">Set aside (DNF)</h2>
          <div class="home-shelf-grid">
            ${dnfBooks.map((book) => renderHomeShelfCard(book)).join('')}
          </div>
        </section>
      `
          : ''
      }
    </div>
  `;

  return {
    title: 'Read',
    html,
    mount(container, onStateChange) {
      container.querySelector('#read-search-input')?.addEventListener('input', (e) => {
        onStateChange(
          { readQuery: e.target.value },
          {
            preserveInputFocus: true,
            focusSelector: '#read-search-input',
            scrollToTop: false,
          }
        );
      });
      container.querySelector('#read-sort-select')?.addEventListener('change', (e) => {
        onStateChange({ readSort: e.target.value }, { scrollToTop: false });
      });
      bindCoverFallbacks(container);
    },
  };
}

export function renderWishlistView(library, state = {}) {
  const wishlistBooks = library.books.filter(isWishlistBook);
  const criteria = {
    query: state.wishlistQuery || '',
  };
  const sortBy = state.wishlistSort || 'recent-added';
  const filtered = sortBooks(filterBooks(wishlistBooks, criteria), sortBy);

  const emptyMessage =
    wishlistBooks.length === 0
      ? 'No books here yet.'
      : 'No books match that search.';

  return {
    title: 'Wishlist',
    html: `
      <div class="container">
        <header class="tbr-page-header">
          <h1 class="tbr-page-title">Wishlist</h1>
          <p class="tbr-page-subtitle">Books I’d love to get to one day. No shopping here, just a discovery list.</p>
        </header>

        <div class="tbr-toolbar">
          <label for="wishlist-search-input" class="sr-only">Search this list</label>
          <input
            id="wishlist-search-input"
            type="search"
            class="neo-input tbr-search-input"
            placeholder="Search this list"
            value="${escapeHtml(criteria.query)}"
          />
          <label for="wishlist-sort-select" class="sr-only">Sort Wishlist books</label>
          <select id="wishlist-sort-select" class="neo-select tbr-sort-select">
            <option value="recent-added" ${sortBy === 'recent-added' ? 'selected' : ''}>Recently added</option>
            <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Title (A–Z)</option>
            <option value="author" ${sortBy === 'author' ? 'selected' : ''}>Author (A–Z)</option>
            <option value="rating-desc" ${sortBy === 'rating-desc' ? 'selected' : ''}>Rating</option>
            <option value="year-desc" ${sortBy === 'year-desc' ? 'selected' : ''}>Publication year</option>
          </select>
        </div>

        <p class="tbr-count-line">
          <strong class="tabular-nums">${escapeHtml(filtered.length)}</strong> ${filtered.length === 1 ? 'book' : 'books'}
        </p>

        ${
          filtered.length > 0
            ? `<div class="home-shelf-grid">${filtered.map((book) => renderHomeShelfCard(book)).join('')}</div>`
            : `<div class="nightstand-empty">${escapeHtml(emptyMessage)}</div>`
        }
      </div>
    `,
    mount(container, onStateChange) {
      container.querySelector('#wishlist-search-input')?.addEventListener('input', (e) => {
        onStateChange(
          { wishlistQuery: e.target.value },
          {
            preserveInputFocus: true,
            focusSelector: '#wishlist-search-input',
            scrollToTop: false,
          }
        );
      });
      container.querySelector('#wishlist-sort-select')?.addEventListener('change', (e) => {
        onStateChange({ wishlistSort: e.target.value }, { scrollToTop: false });
      });
      bindCoverFallbacks(container);
    },
  };
}

export function renderGenresView(library, selectedSlug) {
  const genres = buildGenreDirectory(library.books);

  if (selectedSlug) {
    const genre = genres.find((g) => g.slug === selectedSlug);
    if (!genre) {
      return {
        title: 'Genre Not Found',
        html: `
          <div class="container">
            <a href="#/genres" class="breadcrumb-link">← All Genres</a>
            <div class="nightstand-empty">No books in the library currently match that genre.</div>
          </div>
        `,
      };
    }

    return {
      title: `${genre.name} — Genres`,
      html: `
        <div class="container">
          <a href="#/genres" class="breadcrumb-link">← All Genres</a>
          <header class="tbr-page-header">
            <h1 class="tbr-page-title">${escapeHtml(genre.name)}</h1>
            <p class="tbr-page-subtitle"><strong class="tabular-nums">${escapeHtml(genre.count)}</strong> ${genre.count === 1 ? 'book' : 'books'} tagged under this genre.</p>
          </header>
          <div class="home-shelf-grid">
            ${genre.books.map((book) => renderHomeShelfCard(book)).join('')}
          </div>
        </div>
      `,
    };
  }

  return {
    title: 'Genres',
    html: `
      <div class="container">
        <header class="${genres.length === 0 ? 'tbr-page-header tbr-page-header--compact' : 'tbr-page-header'}">
          <h1 class="tbr-page-title">Genres</h1>
          ${
            genres.length > 0
              ? `<p class="tbr-page-subtitle"><strong class="tabular-nums">${escapeHtml(genres.length)}</strong> literary genres across the collection.</p>`
              : ''
          }
        </header>

        ${
          genres.length === 0
            ? `<div class="nightstand-empty">No genres yet. Genres will appear here once books are tagged in the catalogue.</div>`
            : `
          <div class="author-directory-grid">
            ${genres
              .map(
                (genre) => `
              <a href="#/genres/${encodeURIComponent(genre.slug)}" class="author-directory-card">
                <div class="author-directory-cover">${renderCoverMarkup(genre.coverBook)}</div>
                <div class="author-directory-info">
                  <h2 class="author-directory-name">${escapeHtml(genre.name)}</h2>
                  <p class="author-directory-count tabular-nums">${escapeHtml(genre.count)} ${genre.count === 1 ? 'book' : 'books'}</p>
                </div>
              </a>
            `
              )
              .join('')}
          </div>
        `
        }
      </div>
    `,
  };
}

export function renderAuthorsView(library, selectedSlug) {
  const authors = buildAuthorDirectory(library.books);

  if (selectedSlug) {
    const author = authors.find((a) => a.slug === selectedSlug);
    if (!author) {
      return {
        title: 'Author Not Found',
        html: `
          <div class="container">
            <a href="#/authors" class="breadcrumb-link">← All Authors</a>
            <div class="nightstand-empty">No books by that author were found in the current catalogue.</div>
          </div>
        `,
      };
    }

    return {
      title: `${author.name} — Authors`,
      html: `
        <div class="container">
          <a href="#/authors" class="breadcrumb-link">← All Authors</a>
          <header class="tbr-page-header">
            <h1 class="tbr-page-title">${escapeHtml(author.name)}</h1>
            <p class="tbr-page-subtitle"><strong class="tabular-nums">${escapeHtml(author.count)}</strong> ${author.count === 1 ? 'book' : 'books'} in the collection.</p>
          </header>
          <div class="home-shelf-grid">
            ${author.books.map((book) => renderHomeShelfCard(book, { showRating: Boolean(book.rating) })).join('')}
          </div>
        </div>
      `,
    };
  }

  return {
    title: 'Authors',
    html: `
      <div class="container">
        <header class="tbr-page-header">
          <h1 class="tbr-page-title">Authors</h1>
          <p class="tbr-page-subtitle">The people behind the pages.</p>
        </header>

        ${
          authors.length === 0
            ? `<div class="nightstand-empty">No authors listed yet.</div>`
            : `
          <div class="author-directory-grid">
            ${authors
              .map(
                (author) => `
              <a href="#/authors/${encodeURIComponent(author.slug)}" class="author-directory-card">
                <div class="author-directory-cover">${renderCoverMarkup(author.coverBook)}</div>
                <div class="author-directory-info">
                  <h2 class="author-directory-name">${escapeHtml(author.name)}</h2>
                  <p class="author-directory-count tabular-nums">${escapeHtml(author.count)} ${author.count === 1 ? 'book' : 'books'}</p>
                </div>
              </a>
            `
              )
              .join('')}
          </div>
        `
        }
      </div>
    `,
  };
}

export function renderHistoryView(library, state) {
  const years = getReadingYears(library.books);
  const completedWithoutDate = library.books.filter(
    (b) => isCompletedBook(b) && !b.date_finished
  );

  if (years.length === 0) {
    return {
      title: 'Reading History',
      html: `
        <div class="container">
          <header class="page-header">
            <div>
              <h1 class="page-title">Reading History</h1>
              <p class="page-description">A chronological record of completed books over time.</p>
            </div>
          </header>
          <div class="empty-state neo-card">
            <h2 class="empty-state-title">No dated reading history yet</h2>
            <p class="empty-state-text">Books marked Read with a finished date will appear on the timeline automatically.</p>
          </div>
        </div>
      `,
    };
  }

  const activeYear =
    state.historyYear && years.includes(Number(state.historyYear))
      ? Number(state.historyYear)
      : years[0];

  const yearStats = computeYearStats(library.books, activeYear);
  const maxMonthCount = Math.max(1, ...yearStats.monthlyCounts);

  const html = `
    <div class="container">
      <header class="page-header">
        <div>
          <h1 class="page-title">Reading History</h1>
          <p class="page-description">Completed books, yearly totals, reading formats, and monthly activity across the years.</p>
        </div>
        <span class="page-count-badge tabular-nums">${escapeHtml(years.length)} ${years.length === 1 ? 'year' : 'years'}</span>
      </header>

      <div class="year-tabs" role="tablist" aria-label="Select reading year">
        ${years
          .map(
            (yr) => `
          <button
            type="button"
            role="tab"
            aria-selected="${yr === activeYear ? 'true' : 'false'}"
            class="year-tab tabular-nums ${yr === activeYear ? 'is-active' : ''}"
            data-history-year="${escapeHtml(yr)}"
          >
            ${escapeHtml(yr)}
          </button>
        `
          )
          .join('')}
      </div>

      <section aria-label="${escapeHtml(activeYear)} statistics">
        <div class="history-summary-grid">
          <div class="stat-tile stat-tile--highlight">
            <span class="stat-value tabular-nums">${escapeHtml(yearStats.completedCount)}</span>
            <span class="stat-label">Completed in ${escapeHtml(activeYear)}</span>
          </div>
          <div class="stat-tile">
            <span class="stat-value tabular-nums">${yearStats.totalPages !== null ? escapeHtml(yearStats.totalPages.toLocaleString()) : 'Unavailable'}</span>
            <span class="stat-label">${yearStats.pagesKnownCount < yearStats.completedCount ? `Pages (${yearStats.pagesKnownCount}/${yearStats.completedCount} books)` : 'Total Pages Read'}</span>
          </div>
          <div class="stat-tile stat-tile--soft">
            <span class="stat-value tabular-nums">${yearStats.averageRating !== null ? escapeHtml(yearStats.averageRating) : 'Unavailable'}</span>
            <span class="stat-label">${yearStats.ratedCount > 0 ? `Avg Rating (${yearStats.ratedCount} rated)` : 'No ratings logged'}</span>
          </div>
          <div class="stat-tile">
            <span class="stat-value" style="font-size: 1.35rem;">${escapeHtml(yearStats.topGenre || 'Unavailable')}</span>
            <span class="stat-label">Most-Read Genre</span>
          </div>
        </div>
      </section>

      <section class="neo-card activity-panel" aria-labelledby="monthly-activity-heading">
        <h2 id="monthly-activity-heading" style="font-size: 1.35rem;">Monthly Completions (${escapeHtml(activeYear)})</h2>
        <div class="month-bars" role="img" aria-label="Monthly completed books chart for ${escapeHtml(activeYear)}">
          ${yearStats.monthlyCounts
            .map((count, idx) => {
              const heightPct = count > 0 ? Math.max(16, Math.round((count / maxMonthCount) * 100)) : 8;
              return `
                <div class="month-col">
                  <span class="month-count tabular-nums">${count > 0 ? escapeHtml(count) : ''}</span>
                  <div class="month-bar ${count === 0 ? 'is-empty' : ''}" style="height: ${heightPct}%;" title="${MONTHS_SHORT[idx]}: ${count} ${count === 1 ? 'book' : 'books'}"></div>
                  <span class="month-label">${MONTHS_SHORT[idx]}</span>
                </div>
              `;
            })
            .join('')}
        </div>

        ${
          yearStats.formats.length > 0
            ? `
          <div style="margin-top: 2rem;">
            <h3 style="font-size: 1.12rem;">Reading Format Distribution</h3>
            <div class="format-bars">
              ${yearStats.formats
                .map((fmt) => {
                  const pct = Math.round((fmt.count / yearStats.completedCount) * 100);
                  return `
                    <div class="format-row">
                      <span>${escapeHtml(fmt.name)}</span>
                      <div class="format-track"><div class="format-fill" style="width: ${pct}%;"></div></div>
                      <span class="mono tabular-nums" style="text-align: right;">${escapeHtml(fmt.count)}</span>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
            : ''
        }
      </section>

      <section class="section-block" aria-labelledby="timeline-heading">
        <div class="section-header">
          <div>
            <h2 id="timeline-heading" class="section-title">${escapeHtml(activeYear)} Reading Timeline</h2>
            <p class="section-subtitle">Ordered chronologically by completion date.</p>
          </div>
        </div>

        <div class="timeline-list">
          ${yearStats.books
            .map((book) => {
              const finished = formatDate(book.date_finished);
              const started = formatDate(book.date_started);
              return `
                <article class="neo-card timeline-entry">
                  <div class="timeline-date">
                    <div>${escapeHtml(finished)}</div>
                    ${started ? `<div style="font-size: 0.76rem; color: var(--color-muted); font-weight: 500;">Started ${escapeHtml(started)}</div>` : ''}
                  </div>
                  <a href="#/book/${encodeURIComponent(book.slug)}" aria-label="View ${escapeHtml(book.title)}">
                    ${renderCoverMarkup(book)}
                  </a>
                  <div style="min-width: 0;">
                    <h3 class="book-card-title">
                      <a href="#/book/${encodeURIComponent(book.slug)}">${escapeHtml(book.title)}</a>
                    </h3>
                    <p class="book-card-author">${escapeHtml(book.author)}</p>
                    <div style="margin-top: 0.45rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem;">
                      ${renderRating(book.rating)}
                      ${book.format ? `<span style="font-size: 0.85rem; color: var(--color-muted);">${escapeHtml(book.format)}</span>` : ''}
                      ${book.pages ? `<span style="font-size: 0.85rem; color: var(--color-muted);" class="tabular-nums">${escapeHtml(book.pages)} pp</span>` : ''}
                    </div>
                  </div>
                </article>
              `;
            })
            .join('')}
        </div>
      </section>

      ${
        completedWithoutDate.length > 0
          ? `<p style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--color-muted);">Note: ${escapeHtml(completedWithoutDate.length)} completed ${completedWithoutDate.length === 1 ? 'book has' : 'books have'} no completion date recorded and ${completedWithoutDate.length === 1 ? 'is' : 'are'} excluded from year-specific totals.</p>`
          : ''
      }
    </div>
  `;

  return {
    title: `Reading History (${activeYear})`,
    html,
    mount(container, onStateChange) {
      container.querySelectorAll('[data-history-year]').forEach((btn) => {
        btn.addEventListener('click', () => {
          onStateChange({ historyYear: Number(btn.getAttribute('data-history-year')) });
        });
      });
      bindCoverFallbacks(container);
    },
  };
}
