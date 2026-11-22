import {
  calculateProgress,
  escapeHtml,
  formatDate,
  normalizeAuthorKey,
  normalizeGenreKey,
  renderCoverMarkup,
  renderRating,
  renderStatusBadge,
  slugify,
} from './utils.js';

function getRelatedBooks(currentBook, allBooks, limit = 4) {
  const currentGenres = new Set((currentBook.genres || []).map(normalizeGenreKey));
  const currentAuthorKey = normalizeAuthorKey(currentBook.author);

  const scored = allBooks
    .filter((candidate) => candidate.id !== currentBook.id && candidate.slug !== currentBook.slug)
    .map((candidate) => {
      let score = 0;
      if (normalizeAuthorKey(candidate.author) === currentAuthorKey) {
        score += 4;
      }
      for (const g of candidate.genres || []) {
        if (currentGenres.has(normalizeGenreKey(g))) {
          score += 3;
        }
      }
      if (candidate.language && candidate.language === currentBook.language) {
        score += 0.5;
      }
      if (candidate.favourite) {
        score += 0.5;
      }
      return { book: candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.book.rating || 0) - (a.book.rating || 0));

  return scored.slice(0, limit).map((entry) => entry.book);
}

export function renderBookCard(book, { showStatus = true, showDateFinished = false } = {}) {
  const authorSlug = slugify(book.author);
  const finishedFormatted = showDateFinished ? formatDate(book.date_finished) : null;
  const genreText = (book.genres || []).slice(0, 2).join(' · ');

  const metaParts = [];
  if (genreText) metaParts.push(escapeHtml(genreText));
  if (book.pages) metaParts.push(`<span class="tabular-nums">${escapeHtml(book.pages)} pp</span>`);
  if (book.publication_year) metaParts.push(`<span class="tabular-nums">${escapeHtml(book.publication_year)}</span>`);
  if (finishedFormatted) metaParts.push(`Finished ${escapeHtml(finishedFormatted)}`);

  const ratingHtml = renderRating(book.rating);

  return `
    <article class="book-card">
      <a href="#/book/${encodeURIComponent(book.slug)}" class="book-card-cover-link" aria-label="View details for ${escapeHtml(book.title)}">
        ${renderCoverMarkup(book)}
      </a>
      <h3 class="book-card-title">
        <a href="#/book/${encodeURIComponent(book.slug)}">${escapeHtml(book.title)}</a>
      </h3>
      <p class="book-card-author">
        <a href="#/authors/${encodeURIComponent(authorSlug)}">${escapeHtml(book.author)}</a>
      </p>
      ${
        metaParts.length > 0
          ? `<div class="book-card-meta">${metaParts.join('<span class="meta-sep" aria-hidden="true">·</span>')}</div>`
          : ''
      }
      <div class="book-card-footer">
        ${showStatus ? renderStatusBadge(book.status) : `<span>${escapeHtml(book.format || '')}</span>`}
        ${ratingHtml || (book.favourite ? '<span class="favourite-mark">Favourite</span>' : '')}
      </div>
    </article>
  `;
}

export function renderBookDetailView(library, slug) {
  const book = library.books.find(
    (b) => b.slug === slug || b.id === slug
  );

  if (!book) {
    return {
      title: 'Book Not Found',
      html: `
        <div class="container">
          <div class="empty-state neo-card">
            <h1 class="empty-state-title">Book not found</h1>
            <p class="empty-state-text">We could not find a book matching that entry in the current library catalogue.</p>
            <div style="margin-top: 1.25rem;">
              <a href="#/" class="neo-btn neo-btn-blue">Back to Library</a>
            </div>
          </div>
        </div>
      `,
    };
  }

  const authorSlug = slugify(book.author);
  const progress = calculateProgress(book.current_page, book.pages);
  const startedText = formatDate(book.date_started);
  const finishedText = formatDate(book.date_finished);
  const addedText = formatDate(book.date_added);

  const metaItems = [
    { label: 'Reading Status', value: book.status },
    { label: 'Genres', value: book.genres?.length ? book.genres.map((g) => `<a href="#/genres/${encodeURIComponent(slugify(g))}">${escapeHtml(g)}</a>`).join(', ') : null, rawHtml: true },
    { label: 'Format', value: book.format },
    { label: 'Pages', value: book.pages ? `${book.pages} pages` : null },
    { label: 'Publication Year', value: book.publication_year ? String(book.publication_year) : null },
    { label: 'Publisher', value: book.publisher },
    { label: 'ISBN', value: book.isbn, mono: true },
    { label: 'Language', value: book.language },
    { label: 'Original Language', value: book.original_language && book.original_language !== book.language ? book.original_language : null },
    { label: 'Ownership', value: book.ownership },
    { label: 'Date Added', value: addedText },
    { label: 'Date Started', value: startedText },
    { label: 'Date Finished', value: finishedText },
  ].filter((item) => item.value !== null && item.value !== undefined && item.value !== '');

  const related = getRelatedBooks(book, library.books, 4);

  const html = `
    <div class="container">
      <a href="#/" class="breadcrumb-link">
        <span aria-hidden="true">←</span>
        <span>Back to Library</span>
      </a>

      <article class="detail-layout">
        <div>
          <div class="detail-cover-box">
            ${renderCoverMarkup(book, { eager: true })}
          </div>

          ${
            book.goodreads_url || book.external_url
              ? `
            <div style="margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.65rem;">
              ${
                book.goodreads_url
                  ? `<a href="${escapeHtml(book.goodreads_url)}" target="_blank" rel="noopener noreferrer" class="neo-btn neo-btn-yellow">View on Goodreads ↗</a>`
                  : ''
              }
              ${
                book.external_url
                  ? `<a href="${escapeHtml(book.external_url)}" target="_blank" rel="noopener noreferrer" class="neo-btn">External Reference ↗</a>`
                  : ''
              }
            </div>
          `
              : ''
          }
        </div>

        <div>
          <header class="detail-header">
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem;">
              ${renderStatusBadge(book.status)}
              ${renderRating(book.rating)}
              ${book.favourite ? '<span class="favourite-mark">★ Favourite Book</span>' : ''}
            </div>
            <h1 class="detail-title">${escapeHtml(book.title)}</h1>
            <p class="detail-author">
              by <a href="#/authors/${encodeURIComponent(authorSlug)}">${escapeHtml(book.author)}</a>
            </p>
          </header>

          ${
            book.description
              ? `<p class="detail-description">${escapeHtml(book.description)}</p>`
              : `<p class="detail-description" style="color: var(--color-muted);">No description has been published for this book yet.</p>`
          }

          ${
            progress !== null && book.status === 'Reading'
              ? `
            <section class="neo-card-yellow detail-section" aria-label="Reading progress">
              <h2 style="font-size: 1.2rem; margin-bottom: 0.5rem;">Reading Progress</h2>
              <div class="progress-meta tabular-nums">
                <span>Page ${escapeHtml(book.current_page)} of ${escapeHtml(book.pages)}</span>
                <span>${escapeHtml(progress)}% complete</span>
              </div>
              <div class="progress-track" role="progressbar" aria-valuenow="${escapeHtml(progress)}" aria-valuemin="0" aria-valuemax="100" aria-label="Reading progress ${escapeHtml(progress)} percent">
                <div class="progress-fill" style="width: ${escapeHtml(progress)}%;"></div>
              </div>
            </section>
          `
              : ''
          }

          <dl class="detail-meta-dl">
            ${metaItems
              .map(
                (item) => `
              <div class="detail-meta-item">
                <dt>${escapeHtml(item.label)}</dt>
                <dd class="${item.mono ? 'mono' : ''}">${item.rawHtml ? item.value : escapeHtml(item.value)}</dd>
              </div>
            `
              )
              .join('')}
          </dl>

          ${
            book.review
              ? `
            <section class="neo-card detail-section">
              <h2 style="font-size: 1.3rem;">Public Review &amp; Notes</h2>
              <p style="margin-top: 0.75rem; line-height: 1.7;">${escapeHtml(book.review)}</p>
            </section>
          `
              : ''
          }

          ${
            book.highlights && book.highlights.length > 0
              ? `
            <section class="neo-card detail-section">
              <h2 style="font-size: 1.3rem;">Public Highlights</h2>
              <ul class="highlight-list">
                ${book.highlights
                  .map((hl) => {
                    const trimmedText = String(hl.text || '').trim();
                    const alreadyQuoted =
                      (trimmedText.startsWith('“') && trimmedText.includes('”')) ||
                      (trimmedText.startsWith('"') && trimmedText.includes('"'));
                    const quoteDisplay = alreadyQuoted ? trimmedText : `“${trimmedText}”`;
                    return `
                  <li class="highlight-item">
                    <blockquote class="highlight-quote" style="margin: 0;">${escapeHtml(quoteDisplay)}</blockquote>
                    ${hl.page ? `<p class="highlight-page">Page ${escapeHtml(hl.page)}</p>` : ''}
                  </li>
                `;
                  })
                  .join('')}
              </ul>
            </section>
          `
              : ''
          }
        </div>
      </article>

      ${
        related.length > 0
          ? `
        <section class="section-block" aria-labelledby="related-books-heading">
          <div class="section-header">
            <div>
              <h2 id="related-books-heading" class="section-title">Related Books in the Library</h2>
              <p class="section-subtitle">Books sharing genres or the same author.</p>
            </div>
          </div>
          <div class="books-grid">
            ${related.map((item) => renderBookCard(item)).join('')}
          </div>
        </section>
      `
          : ''
      }
    </div>
  `;

  return {
    title: `${book.title} by ${book.author}`,
    html,
  };
}
