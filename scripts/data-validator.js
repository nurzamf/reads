import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMappingConfig } from './notion-mapper.js';
import { normalizeMultilineText, normalizeWhitespace, readJsonSafe, slugify } from './utils.js';

function isSafeHttpOrLocalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('./') || trimmed.startsWith('assets/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  if (!value || typeof value !== 'string') return false;
  const match = value.trim().match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) return false;
  const parsed = new Date(match[0]);
  return !Number.isNaN(parsed.getTime());
}

function cleanNumber(val, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return integer ? Math.trunc(num) : Math.round(num * 100) / 100;
}

function deduplicateGenres(genres) {
  if (!Array.isArray(genres)) return [];
  const seen = new Map();
  for (const item of genres) {
    const clean = normalizeWhitespace(String(item || ''));
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, clean);
    }
  }
  return Array.from(seen.values());
}

export function validateAndSanitiseBooks(rawBooks, config = loadMappingConfig()) {
  const allowlist = new Set(config.publicAllowlist || []);
  const usedSlugs = new Set();
  const seenIdentity = new Set();
  const warnings = [];
  const validBooks = [];

  for (let i = 0; i < rawBooks.length; i += 1) {
    const raw = rawBooks[i];
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Skipped invalid non-object book at index ${i}.`);
      continue;
    }

    const title = normalizeWhitespace(String(raw.title || ''));
    if (!title) {
      warnings.push(`Skipped book at index ${i} with missing title.`);
      continue;
    }

    const author = normalizeWhitespace(String(raw.author || '')) || 'Unknown Author';

    // Duplicate detection by notion_page_id, isbn, or normalized title+author
    const identityKey = raw.notion_page_id
      ? `notion:${raw.notion_page_id}`
      : raw.isbn
        ? `isbn:${normalizeWhitespace(String(raw.isbn)).replace(/[^0-9Xx]/g, '')}`
        : `title-author:${title.toLowerCase()}::${author.toLowerCase()}`;

    if (seenIdentity.has(identityKey)) {
      warnings.push(`Duplicate record detected and skipped for "${title}" by ${author}.`);
      continue;
    }
    seenIdentity.add(identityKey);

    let baseSlug = normalizeWhitespace(String(raw.slug || '')) || slugify(title);
    let uniqueSlug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(uniqueSlug)) {
      uniqueSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(uniqueSlug);

    const candidate = {
      id: normalizeWhitespace(String(raw.id || raw.notion_page_id || uniqueSlug)),
      slug: uniqueSlug,
      notion_page_id: raw.notion_page_id || null,
      title,
      author,
      cover_url: isSafeHttpOrLocalUrl(raw.cover_url) ? raw.cover_url.trim() : null,
      description: normalizeMultilineText(String(raw.description || '')) || null,
      language: normalizeWhitespace(String(raw.language || '')) || null,
      original_language: normalizeWhitespace(String(raw.original_language || '')) || null,
      publication_year: cleanNumber(raw.publication_year, { min: 1, max: 2100, integer: true }),
      publisher: normalizeWhitespace(String(raw.publisher || '')) || null,
      isbn: normalizeWhitespace(String(raw.isbn || '')) || null,
      pages: cleanNumber(raw.pages, { min: 1, max: 20000, integer: true }),
      format: normalizeWhitespace(String(raw.format || '')) || null,
      status: normalizeWhitespace(String(raw.status || '')) || 'To Be Read',
      ownership: normalizeWhitespace(String(raw.ownership || '')) || null,
      current_page: cleanNumber(raw.current_page, { min: 0, max: 20000, integer: true }),
      rating: cleanNumber(raw.rating, { min: 0.5, max: 5 }),
      favourite: Boolean(raw.favourite),
      genres: deduplicateGenres(raw.genres),
      date_added: isIsoDate(raw.date_added) ? raw.date_added.trim().slice(0, 10) : null,
      date_started: isIsoDate(raw.date_started) ? raw.date_started.trim().slice(0, 10) : null,
      date_finished: isIsoDate(raw.date_finished) ? raw.date_finished.trim().slice(0, 10) : null,
      review: normalizeMultilineText(String(raw.review || '')) || null,
      highlights: Array.isArray(raw.highlights)
        ? raw.highlights
            .filter((h) => h && typeof h.text === 'string' && normalizeWhitespace(h.text) !== '')
            .map((h) => ({
              text: normalizeWhitespace(h.text),
              page: cleanNumber(h.page, { min: 1, max: 20000, integer: true }),
            }))
        : [],
      goodreads_url: isSafeHttpOrLocalUrl(raw.goodreads_url) ? raw.goodreads_url.trim() : null,
      external_url: isSafeHttpOrLocalUrl(raw.external_url) ? raw.external_url.trim() : null,
      original_title: normalizeWhitespace(String(raw.original_title || '')) || null,
      series: normalizeWhitespace(String(raw.series || '')) || null,
      awards: deduplicateGenres(raw.awards),
      goodreads_rating: cleanNumber(raw.goodreads_rating, { min: 0, max: 5 }),
    };

    const sanitised = {};
    for (const [key, value] of Object.entries(candidate)) {
      if (allowlist.has(key)) {
        sanitised[key] = value;
      }
    }
    validBooks.push(sanitised);
  }

  return {
    books: validBooks,
    warnings,
  };
}

// CLI execution when called directly via `npm run validate`
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const libraryPath = path.resolve(process.cwd(), 'data/library.json');
  const existing = readJsonSafe(libraryPath);
  if (!existing || !Array.isArray(existing.books)) {
    console.error('Error: data/library.json is missing or invalid.');
    process.exit(1);
  }
  const { books, warnings } = validateAndSanitiseBooks(existing.books);
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(`Validated ${books.length} books in data/library.json (${warnings.length} warnings).`);
}
