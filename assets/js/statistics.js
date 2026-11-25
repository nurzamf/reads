import {
  normalizeAuthorKey,
  normalizeGenreKey,
  parseDateMonthIndex,
  parseDateYear,
  slugify,
} from './utils.js';

export function isCompletedBook(book) {
  return String(book.status).toLowerCase() === 'read';
}

export function isDnfBook(book) {
  return String(book.status).toLowerCase() === 'dnf';
}

export function isReadingBook(book) {
  return String(book.status).toLowerCase() === 'reading';
}

export function isToReadBook(book) {
  return String(book.status).toLowerCase() === 'to be read';
}

export function isWishlistBook(book) {
  return String(book.status).toLowerCase() === 'wishlist';
}

export function computeAverageRating(books) {
  const rated = books.filter(
    (b) => typeof b.rating === 'number' && Number.isFinite(b.rating) && b.rating > 0
  );
  if (rated.length === 0) return null;
  const sum = rated.reduce((acc, b) => acc + b.rating, 0);
  return {
    average: Math.round((sum / rated.length) * 100) / 100,
    ratedCount: rated.length,
  };
}

export function computeCollectionStats(books) {
  const ownedBooks = books.filter((b) => !isWishlistBook(b));
  const readBooks = books.filter(isCompletedBook);
  const readingBooks = books.filter(isReadingBook);
  const toReadBooks = books.filter(isToReadBook);
  const wishlistBooks = books.filter(isWishlistBook);
  const dnfBooks = books.filter(isDnfBook);

  const ratingSummary = computeAverageRating(ownedBooks);
  const readRatingSummary = computeAverageRating(readBooks);

  const pagesReadBooks = readBooks.filter(
    (b) => typeof b.pages === 'number' && Number.isFinite(b.pages) && b.pages > 0
  );
  const totalPagesRead =
    pagesReadBooks.length > 0
      ? pagesReadBooks.reduce((sum, b) => sum + b.pages, 0)
      : null;

  return {
    totalBooks: ownedBooks.length,
    readCount: readBooks.length,
    readingCount: readingBooks.length,
    toReadCount: toReadBooks.length,
    wishlistCount: wishlistBooks.length,
    dnfCount: dnfBooks.length,
    averageRating: ratingSummary ? ratingSummary.average : null,
    ratedCount: ratingSummary ? ratingSummary.ratedCount : 0,
    readAverageRating: readRatingSummary ? readRatingSummary.average : null,
    totalPagesRead,
    pagesKnownCount: pagesReadBooks.length,
  };
}

export function buildGenreDirectory(books) {
  const map = new Map();

  for (const book of books) {
    for (const genre of book.genres || []) {
      const key = normalizeGenreKey(genre);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          key,
          slug: slugify(genre),
          name: genre,
          books: [],
          coverBook: null,
        });
      }
      const entry = map.get(key);
      entry.books.push(book);
      if (!entry.coverBook && book.cover_url) {
        entry.coverBook = book;
      }
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      count: entry.books.length,
      coverBook: entry.coverBook || entry.books[0] || null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildAuthorDirectory(books) {
  const map = new Map();

  for (const book of books) {
    const key = normalizeAuthorKey(book.author);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        key,
        slug: slugify(book.author),
        name: book.author,
        books: [],
        coverBook: null,
      });
    }
    const entry = map.get(key);
    entry.books.push(book);
    if (!entry.coverBook && book.cover_url) {
      entry.coverBook = book;
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      count: entry.books.length,
      coverBook: entry.coverBook || entry.books[0] || null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function getReadingYears(books) {
  const years = new Set();
  for (const book of books) {
    if (!isCompletedBook(book)) continue;
    const year = parseDateYear(book.date_finished);
    if (year) years.add(year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

export function computeYearStats(books, year) {
  const yearBooks = books
    .filter((b) => isCompletedBook(b) && parseDateYear(b.date_finished) === year)
    .sort((a, b) => b.date_finished.localeCompare(a.date_finished));

  const pagesBooks = yearBooks.filter(
    (b) => typeof b.pages === 'number' && Number.isFinite(b.pages) && b.pages > 0
  );
  const totalPages =
    pagesBooks.length > 0
      ? pagesBooks.reduce((sum, b) => sum + b.pages, 0)
      : null;

  const ratingSummary = computeAverageRating(yearBooks);

  const genreCounts = new Map();
  for (const book of yearBooks) {
    for (const genre of book.genres || []) {
      const key = normalizeGenreKey(genre);
      if (!key) continue;
      if (!genreCounts.has(key)) {
        genreCounts.set(key, { name: genre, count: 0 });
      }
      genreCounts.get(key).count += 1;
    }
  }
  const topGenreEntry = Array.from(genreCounts.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  )[0] || null;

  const formatMap = new Map();
  for (const book of yearBooks) {
    if (!book.format) continue;
    formatMap.set(book.format, (formatMap.get(book.format) || 0) + 1);
  }
  const formats = Array.from(formatMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const monthlyCounts = Array.from({ length: 12 }, () => 0);
  for (const book of yearBooks) {
    const monthIdx = parseDateMonthIndex(book.date_finished);
    if (monthIdx !== null) {
      monthlyCounts[monthIdx] += 1;
    }
  }

  return {
    year,
    books: yearBooks,
    completedCount: yearBooks.length,
    totalPages,
    pagesKnownCount: pagesBooks.length,
    averageRating: ratingSummary ? ratingSummary.average : null,
    ratedCount: ratingSummary ? ratingSummary.ratedCount : 0,
    topGenre: topGenreEntry ? topGenreEntry.name : null,
    formats,
    monthlyCounts,
  };
}
