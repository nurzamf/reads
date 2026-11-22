import {
  isSafeUrl,
  isValidDateString,
  normalizeMultilineText,
  normalizeWhitespace,
  slugify,
  toTitleCasePreserving,
} from './utils.js';

const CACHE_KEY = 'nurzams_library_cache_v3';
const DATA_URL = './data/library.json';

let memoryLibrary = null;

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeGenres(rawBook) {
  const collected = [];
  if (Array.isArray(rawBook.genres)) {
    collected.push(...rawBook.genres);
  }
  if (typeof rawBook.genre === 'string') {
    collected.push(rawBook.genre);
  }
  if (typeof rawBook.secondary_genre === 'string') {
    collected.push(rawBook.secondary_genre);
  }

  const seen = new Map();
  for (const item of collected) {
    const clean = toTitleCasePreserving(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, clean);
    }
  }
  return Array.from(seen.values());
}

function normalizeHighlights(rawHighlights) {
  if (!Array.isArray(rawHighlights)) return [];
  return rawHighlights
    .filter((item) => item && typeof item.text === 'string' && normalizeWhitespace(item.text) !== '')
    .filter((item) => item.visibility === undefined || String(item.visibility).toLowerCase() === 'public')
    .map((item) => ({
      text: normalizeWhitespace(item.text),
      page: normalizeNumber(item.page),
    }));
}

export function normalizeBook(raw, index = 0) {
  const title = normalizeWhitespace(raw?.title) || 'Untitled Book';
  const author = normalizeWhitespace(raw?.author) || 'Unknown Author';
  const slug = normalizeWhitespace(raw?.slug) || slugify(`${title}-${author}`) || `book-${index + 1}`;
  const id = normalizeWhitespace(raw?.id) || slug;

  const pages = normalizeNumber(raw?.pages);
  const currentPage = normalizeNumber(raw?.current_page);
  const rating = normalizeNumber(raw?.rating);
  const goodreadsRating = normalizeNumber(raw?.goodreads_rating);
  const publicationYear = normalizeNumber(raw?.publication_year);

  const awards = Array.isArray(raw?.awards)
    ? raw.awards.map((a) => normalizeWhitespace(String(a || ''))).filter(Boolean)
    : [];

  return {
    id,
    slug,
    title,
    author,
    cover_url: isSafeUrl(raw?.cover_url) ? raw.cover_url.trim() : null,
    description: normalizeMultilineText(raw?.description) || null,
    language: normalizeWhitespace(raw?.language) || null,
    original_language: normalizeWhitespace(raw?.original_language) || null,
    original_title: normalizeWhitespace(raw?.original_title) || null,
    series: normalizeWhitespace(raw?.series) || null,
    awards,
    publication_year: publicationYear && publicationYear > 0 ? Math.trunc(publicationYear) : null,
    publisher: normalizeWhitespace(raw?.publisher) || null,
    isbn: normalizeWhitespace(raw?.isbn) || null,
    pages: pages && pages > 0 ? Math.trunc(pages) : null,
    format: normalizeWhitespace(raw?.format) || null,
    status: normalizeWhitespace(raw?.status) || 'Uncategorised',
    ownership: normalizeWhitespace(raw?.ownership) || null,
    current_page: currentPage !== null && currentPage >= 0 ? Math.trunc(currentPage) : null,
    rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    goodreads_rating:
      goodreadsRating !== null && goodreadsRating > 0 && goodreadsRating <= 5
        ? Math.round(goodreadsRating * 100) / 100
        : null,
    favourite: Boolean(raw?.favourite),
    genres: normalizeGenres(raw || {}),
    date_added: isValidDateString(raw?.date_added) ? raw.date_added.trim().slice(0, 10) : null,
    date_started: isValidDateString(raw?.date_started) ? raw.date_started.trim().slice(0, 10) : null,
    date_finished: isValidDateString(raw?.date_finished) ? raw.date_finished.trim().slice(0, 10) : null,
    review: normalizeMultilineText(raw?.review) || null,
    highlights: normalizeHighlights(raw?.highlights),
    goodreads_url: isSafeUrl(raw?.goodreads_url) ? raw.goodreads_url.trim() : null,
    external_url: isSafeUrl(raw?.external_url) ? raw.external_url.trim() : null,
  };
}

function normalizeLibraryPayload(payload) {
  if (!payload || !Array.isArray(payload.books)) {
    throw new Error('Library data has an unexpected format.');
  }
  const books = payload.books.map((book, index) => normalizeBook(book, index));
  return {
    last_updated: typeof payload.last_updated === 'string' ? payload.last_updated : null,
    is_sample_data: Boolean(payload.is_sample_data),
    sample_notice: typeof payload.sample_notice === 'string' ? payload.sample_notice : null,
    total_books: books.length,
    books,
  };
}

export async function loadLibrary({ forceRefresh = false } = {}) {
  if (!forceRefresh && memoryLibrary) {
    return memoryLibrary;
  }

  if (!forceRefresh) {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = normalizeLibraryPayload(JSON.parse(cached));
        memoryLibrary = parsed;
        return parsed;
      }
    } catch {
      // Ignore storage restrictions or stale cache entries
    }
  }

  const response = await fetch(DATA_URL, {
    cache: forceRefresh ? 'no-cache' : 'default',
  });

  if (!response.ok) {
    throw new Error(`Could not load library data (HTTP ${response.status}).`);
  }

  const json = await response.json();
  const normalized = normalizeLibraryPayload(json);
  memoryLibrary = normalized;

  try {
    if (!normalized.is_sample_data) {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(json));
    }
  } catch {
    // Ignore sessionStorage quota issues
  }

  return normalized;
}
