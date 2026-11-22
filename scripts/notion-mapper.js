import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWhitespace } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'notion-mapping.config.json');

export function loadMappingConfig(configPath = DEFAULT_CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function isPrivatePropertyName(propName, privatePatterns = []) {
  const lower = String(propName || '').toLowerCase();
  return privatePatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

export function resolveSchemaMapping(schemaProperties, config) {
  const propNames = Object.keys(schemaProperties || {});
  const propByLower = new Map(propNames.map((name) => [name.toLowerCase(), name]));
  const mapping = {};
  const usedNotionProps = new Set();

  for (const [internalField, candidates] of Object.entries(config.properties || {})) {
    for (const candidate of candidates) {
      const matched = propByLower.get(candidate.toLowerCase());
      if (matched && !isPrivatePropertyName(matched, config.privateFieldPatterns)) {
        mapping[internalField] = matched;
        usedNotionProps.add(matched);
        break;
      }
    }
  }

  const unmapped = [];
  const privateSkipped = [];
  for (const name of propNames) {
    if (usedNotionProps.has(name)) continue;
    if (isPrivatePropertyName(name, config.privateFieldPatterns)) {
      privateSkipped.push({ name, type: schemaProperties[name]?.type || 'unknown' });
    } else {
      unmapped.push({ name, type: schemaProperties[name]?.type || 'unknown' });
    }
  }

  const missingRecommended = Object.keys(config.properties || {}).filter(
    (field) => !mapping[field] && !field.endsWith('_public_flag')
  );

  return {
    mapping,
    unmapped,
    privateSkipped,
    missingRecommended,
  };
}

function extractRichText(richTextArr) {
  if (!Array.isArray(richTextArr)) return '';
  return normalizeWhitespace(richTextArr.map((item) => item?.plain_text || '').join(''));
}

export function extractPropertyValue(prop) {
  if (!prop || !prop.type) return null;

  switch (prop.type) {
    case 'title':
      return extractRichText(prop.title) || null;
    case 'rich_text':
      return extractRichText(prop.rich_text) || null;
    case 'select':
      return normalizeWhitespace(prop.select?.name || '') || null;
    case 'status':
      return normalizeWhitespace(prop.status?.name || '') || null;
    case 'multi_select':
      return Array.isArray(prop.multi_select)
        ? prop.multi_select.map((opt) => normalizeWhitespace(opt?.name || '')).filter(Boolean)
        : [];
    case 'number':
      return typeof prop.number === 'number' && Number.isFinite(prop.number) ? prop.number : null;
    case 'checkbox':
      return Boolean(prop.checkbox);
    case 'date':
      return prop.date?.start ? prop.date.start.slice(0, 10) : null;
    case 'created_time':
      return prop.created_time ? prop.created_time.slice(0, 10) : null;
    case 'url':
      return prop.url ? prop.url.trim() : null;
    case 'files': {
      const first = Array.isArray(prop.files) ? prop.files[0] : null;
      if (!first) return null;
      if (first.type === 'external') return first.external?.url || null;
      if (first.type === 'file') return first.file?.url || null;
      return null;
    }
    case 'formula':
      if (!prop.formula) return null;
      if (prop.formula.type === 'string') return normalizeWhitespace(prop.formula.string || '') || null;
      if (prop.formula.type === 'number') return prop.formula.number ?? null;
      if (prop.formula.type === 'boolean') return Boolean(prop.formula.boolean);
      if (prop.formula.type === 'date') return prop.formula.date?.start?.slice(0, 10) || null;
      return null;
    case 'people':
      return Array.isArray(prop.people)
        ? prop.people.map((p) => normalizeWhitespace(p?.name || '')).filter(Boolean).join(', ') || null
        : null;
    case 'rollup':
      if (!prop.rollup) return null;
      if (prop.rollup.type === 'number') return prop.rollup.number ?? null;
      if (prop.rollup.type === 'array' && Array.isArray(prop.rollup.array)) {
        return prop.rollup.array.map(extractPropertyValue).flat().filter(Boolean);
      }
      return null;
    default:
      return null;
  }
}

function extractPageCover(page) {
  if (!page?.cover) return null;
  if (page.cover.type === 'external') return page.cover.external?.url || null;
  if (page.cover.type === 'file') return page.cover.file?.url || null;
  return null;
}

function mapCanonicalLabel(rawValue, lookupMap) {
  if (!rawValue) return null;
  const key = normalizeWhitespace(String(rawValue)).toLowerCase();
  return lookupMap[key] || normalizeWhitespace(String(rawValue));
}

function parseHighlights(rawVal) {
  if (!rawVal) return [];
  if (Array.isArray(rawVal)) {
    return rawVal
      .map((item) => ({ text: normalizeWhitespace(String(item)), page: null }))
      .filter((item) => item.text !== '');
  }
  if (typeof rawVal === 'string') {
    return rawVal
      .split(/\r?\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .map((text) => ({ text, page: null }));
  }
  return [];
}

export function mapNotionPageToBook(page, resolvedMapping, config) {
  const props = page.properties || {};
  const get = (field) => {
    const notionPropName = resolvedMapping[field];
    if (!notionPropName || !props[notionPropName]) return null;
    return extractPropertyValue(props[notionPropName]);
  };

  const title = get('title') || 'Untitled Book';
  const rawAuthor = get('author');
  const author = Array.isArray(rawAuthor) ? rawAuthor.join(', ') : rawAuthor || 'Unknown Author';

  const rawGenres = [];
  const primaryGenre = get('genres');
  if (Array.isArray(primaryGenre)) rawGenres.push(...primaryGenre);
  else if (typeof primaryGenre === 'string') rawGenres.push(...primaryGenre.split(/[,;]/));

  const secondaryGenre = get('secondary_genre');
  if (Array.isArray(secondaryGenre)) rawGenres.push(...secondaryGenre);
  else if (typeof secondaryGenre === 'string') rawGenres.push(...secondaryGenre.split(/[,;]/));

  const coverUrl = get('cover_url') || extractPageCover(page);

  const reviewPropName = resolvedMapping.review || '';
  const reviewFlag = get('review_public_flag');
  const isExplicitlyPublicReview =
    reviewPropName.toLowerCase().includes('public') ||
    reviewFlag === true ||
    String(reviewFlag || '').toLowerCase() === 'public';
  const review = isExplicitlyPublicReview ? get('review') : null;

  const highlightsPropName = resolvedMapping.highlights || '';
  const highlightsFlag = get('highlights_public_flag');
  const publicHighlightProps = (config.publicHighlightProperties || []).map((p) =>
    p.toLowerCase()
  );
  const isExplicitlyPublicHighlights =
    highlightsPropName.toLowerCase().includes('public') ||
    publicHighlightProps.includes(highlightsPropName.toLowerCase()) ||
    highlightsFlag === true ||
    String(highlightsFlag || '').toLowerCase() === 'public';
  const highlights = isExplicitlyPublicHighlights ? parseHighlights(get('highlights')) : [];

  // Support Notion date ranges (e.g. "Date Read" with start & end dates)
  let dateStarted = get('date_started');
  let dateFinished = get('date_finished');
  const finishedPropName = resolvedMapping.date_finished;
  const rawFinishedProp = finishedPropName ? props[finishedPropName] : null;
  if (rawFinishedProp?.type === 'date' && rawFinishedProp.date?.start) {
    if (rawFinishedProp.date.end) {
      if (!dateStarted) {
        dateStarted = rawFinishedProp.date.start.slice(0, 10);
      }
      dateFinished = rawFinishedProp.date.end.slice(0, 10);
    } else {
      dateFinished = rawFinishedProp.date.start.slice(0, 10);
    }
  }

  const rawStatus = get('status');
  const rawFormat = get('format');

  const candidate = {
    id: page.id,
    notion_page_id: page.id,
    title,
    author,
    cover_url: coverUrl,
    description: get('description'),
    language: get('language'),
    original_language: get('original_language'),
    publication_year: get('publication_year'),
    publisher: get('publisher'),
    isbn: get('isbn') !== null ? String(get('isbn')) : null,
    pages: get('pages'),
    format: mapCanonicalLabel(rawFormat, config.formatMap || {}),
    status: mapCanonicalLabel(rawStatus, config.statusMap || {}) || 'To Be Read',
    ownership: get('ownership'),
    current_page: get('current_page'),
    rating: get('rating'),
    favourite: Boolean(get('favourite')),
    genres: rawGenres.map((g) => normalizeWhitespace(String(g))).filter(Boolean),
    date_added: get('date_added') || (page.created_time ? page.created_time.slice(0, 10) : null),
    date_started: dateStarted,
    date_finished: dateFinished,
    review,
    highlights,
    goodreads_url: get('goodreads_url'),
    external_url: get('external_url'),
  };

  // Enforce public-only allowlist
  const allowlist = new Set(config.publicAllowlist || []);
  const sanitised = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (allowlist.has(key)) {
      sanitised[key] = value;
    }
  }
  return sanitised;
}
