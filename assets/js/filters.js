import {
  escapeHtml,
  normalizeAuthorKey,
  normalizeGenreKey,
  parseDateYear,
} from './utils.js';

export function filterBooks(books, criteria) {
  const query = (criteria.query || '').trim().toLowerCase();
  const genreKey = criteria.genre ? normalizeGenreKey(criteria.genre) : '';
  const authorKey = criteria.author ? normalizeAuthorKey(criteria.author) : '';
  const format = criteria.format || '';
  const year = criteria.year ? Number.parseInt(criteria.year, 10) : null;
  const minRating = criteria.minRating ? Number.parseFloat(criteria.minRating) : null;

  return books.filter((book) => {
    if (query) {
      const haystack = [
        book.title,
        book.author,
        book.format || '',
        ...(book.genres || []),
        book.publisher || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (genreKey) {
      const matchesGenre = (book.genres || []).some((g) => normalizeGenreKey(g) === genreKey);
      if (!matchesGenre) return false;
    }

    if (authorKey) {
      if (normalizeAuthorKey(book.author) !== authorKey) return false;
    }

    if (format && book.format !== format) {
      return false;
    }

    if (year) {
      if (parseDateYear(book.date_finished) !== year) return false;
    }

    if (minRating !== null && !Number.isNaN(minRating)) {
      if (typeof book.rating !== 'number' || book.rating < minRating) return false;
    }

    return true;
  });
}

export function sortBooks(books, sortBy = 'recent-added') {
  const list = [...books];

  const compareNullableNumDesc = (aVal, bVal) => {
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return bVal - aVal;
  };

  const compareNullableNumAsc = (aVal, bVal) => {
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return aVal - bVal;
  };

  switch (sortBy) {
    case 'recent-finished':
      return list.sort((a, b) =>
        (b.date_finished || '').localeCompare(a.date_finished || '') ||
        a.title.localeCompare(b.title)
      );
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'author':
      return list.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
    case 'pages-asc':
      return list.sort((a, b) => compareNullableNumAsc(a.pages, b.pages) || a.title.localeCompare(b.title));
    case 'pages-desc':
      return list.sort((a, b) => compareNullableNumDesc(a.pages, b.pages) || a.title.localeCompare(b.title));
    case 'year-desc':
      return list.sort(
        (a, b) => compareNullableNumDesc(a.publication_year, b.publication_year) || a.title.localeCompare(b.title)
      );
    case 'rating-desc':
      return list.sort((a, b) => compareNullableNumDesc(a.rating, b.rating) || a.title.localeCompare(b.title));
    case 'recent-added':
    default:
      return list.sort((a, b) =>
        (b.date_added || '').localeCompare(a.date_added || '') ||
        a.title.localeCompare(b.title)
      );
  }
}

export function collectFilterOptions(books) {
  const genresMap = new Map();
  const authorsMap = new Map();
  const formatsSet = new Set();
  const yearsSet = new Set();

  for (const book of books) {
    for (const g of book.genres || []) {
      const k = normalizeGenreKey(g);
      if (k && !genresMap.has(k)) genresMap.set(k, g);
    }
    const ak = normalizeAuthorKey(book.author);
    if (ak && !authorsMap.has(ak)) authorsMap.set(ak, book.author);
    if (book.format) formatsSet.add(book.format);
    const yr = parseDateYear(book.date_finished);
    if (yr) yearsSet.add(yr);
  }

  return {
    genres: Array.from(genresMap.values()).sort((a, b) => a.localeCompare(b)),
    authors: Array.from(authorsMap.values()).sort((a, b) => a.localeCompare(b)),
    formats: Array.from(formatsSet).sort((a, b) => a.localeCompare(b)),
    years: Array.from(yearsSet).sort((a, b) => b - a),
  };
}

export function renderOptions(values, selectedValue, defaultLabel) {
  const optionsHtml = values
    .map((val) => {
      const strVal = String(val);
      const selected = strVal === String(selectedValue) ? 'selected' : '';
      return `<option value="${escapeHtml(strVal)}" ${selected}>${escapeHtml(strVal)}</option>`;
    })
    .join('');
  return `<option value="">${escapeHtml(defaultLabel)}</option>${optionsHtml}`;
}
