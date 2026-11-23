import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndSanitiseBooks } from './data-validator.js';
import { loadMappingConfig } from './notion-mapper.js';
import {
  normalizeMultilineText,
  normalizeWhitespace,
  readJsonSafe,
  sleep,
  writeJsonAtomic,
} from './utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const OPENLIBRARY_LANGUAGE_MAP = {
  eng: 'English',
  en: 'English',
  msa: 'Malay',
  may: 'Malay',
  ms: 'Malay',
  ind: 'Indonesian',
  id: 'Indonesian',
  jpn: 'Japanese',
  ja: 'Japanese',
  kor: 'Korean',
  ko: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  spa: 'Spanish',
  es: 'Spanish',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  ita: 'Italian',
  it: 'Italian',
  por: 'Portuguese',
  pt: 'Portuguese',
  rus: 'Russian',
  ru: 'Russian',
  ara: 'Arabic',
  ar: 'Arabic',
};

const SKIP_PUBLISHER_PATTERNS = [
  /large print/i,
  /center point/i,
  /cengage/i,
  /thorndike/i,
  /taylor\s*&?\s*francis/i,
  /planeta/i,
  /salamandra/i,
  /einaudi/i,
  /heyne/i,
  /umbriel/i,
  /actes sud/i,
  /bonniers/i,
  /nan hai/i,
  /nuevos tiempos/i,
  /oceano de mexico/i,
  /shinch[oō]sha/i,
  /gent[oō]sha/i,
  /mondadori/i,
  /sukkubus/i,
  /swiat ksiazki/i,
  /yayinlari/i,
  /harper audio/i,
  /bound to stay bound/i,
  /ara mini/i,
  /ara llibres/i,
  /debolsillo/i,
  /ediciones/i,
  /edicions/i,
  /suma de letras/i,
  /boekerij/i,
  /arqueiro/i,
  /gallimard/i,
  /livre de poche/i,
];

// Clean, canonical Goodreads-style literary genre taxonomy
const GENRE_MAP = {
  // Core Fiction & Literary
  'fiction': 'Fiction',
  'fiction & literature': 'Fiction',
  'literary': 'Literary Fiction',
  'literary fiction': 'Literary Fiction',
  'contemporary': 'Contemporary',
  'contemporary fiction': 'Contemporary',
  'family fiction & literature': 'Family Saga',
  'family': 'Family Saga',
  'family saga': 'Family Saga',
  'sagas': 'Family Saga',
  'domestic fiction': 'Fiction',

  // Historical
  'historical': 'Historical Fiction',
  'historical fiction': 'Historical Fiction',
  'historical romance': 'Historical Fiction',
  'world war, 1939-1945': 'Historical Fiction',
  'war & military': 'War Fiction',

  // Mystery / Thriller / Crime
  'mystery': 'Mystery',
  'mysteries & thrillers': 'Mystery & Thriller',
  'mystery thriller': 'Mystery & Thriller',
  'mystery & detective': 'Mystery',
  'women sleuths': 'Mystery',
  'thriller': 'Thriller',
  'thrillers': 'Thriller',
  'suspense': 'Thriller',
  'psychological thriller': 'Thriller',
  'psychological': 'Psychological',
  'psychological fiction': 'Psychological',
  'crime': 'Crime',
  'police procedural': 'Crime',

  // Speculative
  'fantasy': 'Fantasy',
  'epic fantasy': 'Fantasy',
  'urban fantasy': 'Fantasy',
  'historical fantasy': 'Fantasy',
  'dark fantasy': 'Fantasy',
  'military fantasy': 'Fantasy',
  'sci-fi & fantasy': 'Fantasy',
  'dark academia': 'Dark Academia',
  'science fiction': 'Science Fiction',
  'science-fiction': 'Science Fiction',
  'sci fi': 'Science Fiction',
  'sci-fi': 'Science Fiction',
  'dystopia': 'Dystopian',
  'dystopian': 'Dystopian',
  'magical realism': 'Magical Realism',
  'time travel': 'Time Travel',
  'time-traveling': 'Time Travel',
  'fairy tales, myths & fables': 'Fantasy',
  'mythology': 'Mythology',
  'retellings': 'Mythology',
  'horror': 'Horror',
  'gothic': 'Gothic',

  // Romance
  'romance': 'Romance',
  'contemporary romance': 'Romance',
  'new adult romance': 'Romance',
  'romantic comedies': 'Romance',
  'paranormal romance': 'Romance',

  // Age, Identity, Format, Regional Literature
  'young adult': 'Young Adult',
  'young adult fiction': 'Young Adult',
  'teen & young adult': 'Young Adult',
  'coming of age': 'Coming of Age',
  'lgbt': 'LGBTQ+',
  'lgbtq': 'LGBTQ+',
  'lgbtq+': 'LGBTQ+',
  'lgbtq novels': 'LGBTQ+',
  'queer': 'LGBTQ+',
  'gay': 'LGBTQ+',
  'lesbians': 'LGBTQ+',
  'classics': 'Classics',
  'classic': 'Classics',
  'short stories': 'Short Stories',
  'epistolary': 'Epistolary',
  'japanese literature': 'Japanese Literature',
  'japanese fiction': 'Japanese Literature',
  'japanese short stories': 'Japanese Literature',

  // Nonfiction (filtered out automatically if book has clear Fiction tags)
  'nonfiction': 'Nonfiction',
  'non-fiction': 'Nonfiction',
  'memoir': 'Memoir',
  'biography': 'Biography',
  'history': 'History',
  'essays': 'Essays',
  'poetry': 'Poetry',
};

const NONFICTION_GENRES = new Set(['Nonfiction', 'History', 'Essays', 'Poetry']);

function httpGetIpv4(url, extraHeaders = {}, { timeoutMs = 12000, redirectsLeft = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const req = transport.get(
      parsedUrl,
      {
        family: 4,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
          ...extraHeaders,
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          httpGetIpv4(nextUrl, extraHeaders, { timeoutMs, redirectsLeft: redirectsLeft - 1 })
            .then(resolve)
            .catch(reject);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout (${timeoutMs}ms): ${url}`));
    });
    req.on('error', reject);
  });
}

async function httpGetWithRetry(url, extraHeaders = {}, { timeoutMs = 12000, retries = 3 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await httpGetIpv4(url, extraHeaders, { timeoutMs });
      if (
        res.status === 403 ||
        res.status === 429 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504
      ) {
        if (attempt < retries) {
          const delay = res.status === 403 || res.status === 429 ? 1800 * (attempt + 1) : 900 * (attempt + 1);
          await sleep(delay);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
      }
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) ? (n === 160 ? ' ' : String.fromCodePoint(n)) : '';
    })
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number.parseInt(code, 10);
      return Number.isFinite(n) ? (n === 160 ? ' ' : String.fromCodePoint(n)) : '';
    });
}

function htmlToCleanMultilineText(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return null;
  const withBreaks = decodeHtmlEntities(rawHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
  const cleaned = normalizeMultilineText(withBreaks);
  return cleaned || null;
}

function normalizeMatchText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitleSubtitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/\s*:\s*(?:A Novel|A GMA Book Club Pick|A Reese's Book Club Pick|Book \d+|A Memoir).*$/i, '')
    .replace(/\s*\([^)]*(?:Edition|Series|Book|#\d+)[^)]*\)\s*$/i, '')
    .trim();
}

function buildSearchTitleVariants(title) {
  const base = stripTitleSubtitle(title);
  const variants = [base];
  const expanded = base
    .replace(/\bLove Song\b/i, 'Love Songs')
    .replace(/\bW\.E\.B\.?\s*Dubois\b/i, 'W. E. B. Du Bois')
    .replace(/\bSt\.\s*/gi, 'St ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (expanded && expanded.toLowerCase() !== base.toLowerCase()) {
    variants.push(expanded);
  }
  return variants;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function isSameAuthorClose(notionAuthor, candidateAuthor) {
  const a = normalizeMatchText(notionAuthor);
  const bRaw = String(candidateAuthor || '').split(/&|,/)[0];
  const b = normalizeMatchText(bRaw);
  const bFull = normalizeMatchText(candidateAuthor);

  if (!a || a === 'unknown author') return true;
  if (!bFull) return false;
  if (a === b || a === bFull || bFull.includes(a) || a.includes(b)) return true;

  const aTokens = a.split(' ');
  const bTokens = b.split(' ');
  const aLast = aTokens[aTokens.length - 1];
  const bLast = bTokens[bTokens.length - 1];
  if (aLast === bLast && (aTokens[0]?.[0] === bTokens[0]?.[0] || aTokens.length === 1 || bTokens.length === 1)) {
    return true;
  }
  if (aLast.length >= 4 && bLast.length >= 4 && levenshtein(aLast, bLast) <= 2) {
    if (aTokens.length === 1 || bTokens.length === 1) return true;
    return aTokens[0] === bTokens[0] || levenshtein(aTokens[0], bTokens[0]) <= 1;
  }
  return false;
}

function isTitleMatch(bookTitle, candidateTitle) {
  const target = normalizeMatchText(stripTitleSubtitle(bookTitle));
  const cand = normalizeMatchText(stripTitleSubtitle(candidateTitle));
  const candBeforeColon = normalizeMatchText(String(candidateTitle || '').split(':')[0]);
  if (!target || !cand) return false;
  if (target === cand || target === candBeforeColon) return true;
  if (target.length >= 10 && levenshtein(target, cand) <= 2) return true;
  if (
    target.length >= 4 &&
    (cand.startsWith(`${target} `) || target.startsWith(`${cand} `))
  ) {
    return true;
  }
  return false;
}

function hasNonLatinScript(str) {
  return Boolean(str && /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(str));
}

function isLatinReadableAuthor(name) {
  return Boolean(name && /[a-zA-Z]{2,}/.test(name));
}

export function extractGoodreadsBookId(goodreadsUrl) {
  if (!goodreadsUrl || typeof goodreadsUrl !== 'string') return null;
  const match = goodreadsUrl.match(/\/book\/show\/(\d+)/i);
  return match ? match[1] : null;
}

function upgradeGoodreadsCoverUrl(url) {
  if (!url || typeof url !== 'string') return null;
  return url.replace(/\._S[XY]\d+_(?:CR[\d,]+_)?/i, '');
}

function isTruncatedText(text) {
  return typeof text === 'string' && /(\.\.\.|…)\s*$/.test(text.trim());
}

function canonicalizeGenresList(rawGenres, { allowFallbackFiction = true } = {}) {
  if (!Array.isArray(rawGenres)) return [];
  const expanded = [];

  for (const raw of rawGenres) {
    const rawStr = normalizeWhitespace(String(raw || ''));
    if (!rawStr) continue;
    if (rawStr.includes('/')) {
      for (const part of rawStr.split('/')) {
        if (part.trim()) expanded.push(part.trim());
      }
    } else if (/^fiction\s*,\s*/i.test(rawStr) && rawStr.includes(',')) {
      for (const part of rawStr.replace(/^fiction\s*,\s*/i, '').split(',')) {
        if (part.trim()) expanded.push(part.trim());
      }
    } else {
      expanded.push(rawStr);
    }
  }

  const seen = new Set();
  const specificFiction = [];
  const nonfiction = [];
  let hasGenericFiction = false;

  for (const item of expanded) {
    const key = normalizeWhitespace(item)
      .replace(/^(?:genre|form|subject)\s*:\s*/i, '')
      .replace(/\s*\(.*?\)\s*$/, '')
      .toLowerCase();
    const mapped = GENRE_MAP[key] || GENRE_MAP[normalizeMatchText(key)];
    if (!mapped) continue;
    if (seen.has(mapped)) continue;
    seen.add(mapped);

    if (mapped === 'Fiction') {
      hasGenericFiction = true;
    } else if (NONFICTION_GENRES.has(mapped)) {
      nonfiction.push(mapped);
    } else {
      specificFiction.push(mapped);
    }
  }

  // Handle "Mystery & Thriller" cleanly alongside separate Mystery/Thriller
  if (specificFiction.includes('Mystery & Thriller')) {
    const cleaned = specificFiction.filter((g) => g !== 'Mystery' && g !== 'Thriller');
    specificFiction.length = 0;
    specificFiction.push(...cleaned);
  }

  // Never mix History/Nonfiction/Poetry noise into clearly fictional novels
  const hasFictionSignal = specificFiction.length > 0 || hasGenericFiction;
  const combined = hasFictionSignal
    ? [...specificFiction, ...(specificFiction.length === 0 && allowFallbackFiction && hasGenericFiction ? ['Fiction'] : [])]
    : [...nonfiction];

  if (hasGenericFiction && combined.length > 0 && !combined.includes('Fiction') && combined.length < 4) {
    // Keep up to 4 crisp genres, putting specific genres first
    return combined.slice(0, 4);
  }

  return combined.slice(0, 4);
}

function parseGoodreadsHtml(html) {
  if (!html || typeof html !== 'string') return null;

  const result = {};
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      const apollo = nextData?.props?.pageProps?.apolloState || {};
      const richBookKey = Object.keys(apollo).find(
        (k) =>
          k.startsWith('Book:') &&
          (apollo[k].description || apollo[k].bookGenres || apollo[k].details)
      );
      const workKey = Object.keys(apollo).find(
        (k) => k.startsWith('Work:') && apollo[k].details
      );
      const bookNode = richBookKey ? apollo[richBookKey] : null;
      const workNode = workKey ? apollo[workKey] : null;

      if (bookNode) {
        const authorRef = bookNode.primaryContributorEdge?.node?.__ref;
        const authorName = authorRef ? apollo[authorRef]?.name : null;
        if (authorName) result.author = normalizeWhitespace(authorName);

        const rawDesc =
          bookNode.description ||
          bookNode['description({"stripped":true})'] ||
          null;
        if (rawDesc) {
          result.description = htmlToCleanMultilineText(rawDesc);
        }

        if (Array.isArray(bookNode.bookGenres) && bookNode.bookGenres.length > 0) {
          const grGenres = canonicalizeGenresList(
            bookNode.bookGenres.map((entry) => entry?.genre?.name || '')
          );
          if (grGenres.length > 0) result.genres = grGenres;
        }

        const details = bookNode.details || {};
        if (details.isbn13 || details.isbn || details.asin) {
          result.isbn = normalizeWhitespace(String(details.isbn13 || details.isbn || details.asin));
        }
        if (typeof details.numPages === 'number' && details.numPages > 0) {
          result.pages = Math.trunc(details.numPages);
        }
        if (details.publisher) {
          result.publisher = normalizeWhitespace(details.publisher);
        }
        if (typeof details.publicationTime === 'number' && Number.isFinite(details.publicationTime)) {
          const year = new Date(details.publicationTime).getUTCFullYear();
          if (year >= 1000 && year <= 2100) result.publication_year = year;
        }
        if (details.language?.name) {
          result.language = normalizeWhitespace(details.language.name);
        }
        if (details.format) {
          result.format = normalizeWhitespace(details.format);
        }
        if (bookNode.imageUrl) {
          result.cover_url = upgradeGoodreadsCoverUrl(bookNode.imageUrl);
        }
        if (Array.isArray(bookNode.bookSeries) && bookNode.bookSeries.length > 0) {
          const firstSeries = bookNode.bookSeries[0];
          const seriesRef = firstSeries?.series?.__ref;
          const seriesTitle = seriesRef ? apollo[seriesRef]?.title : firstSeries?.series?.title;
          if (seriesTitle) {
            const pos = firstSeries?.userPosition ? ` #${firstSeries.userPosition}` : '';
            result.series = normalizeWhitespace(`${seriesTitle}${pos}`);
          }
        }
      }

      if (workNode?.details) {
        if (workNode.details.originalTitle) {
          result.original_title = normalizeWhitespace(workNode.details.originalTitle);
        }
        if (!result.publication_year && typeof workNode.details.publicationTime === 'number') {
          const year = new Date(workNode.details.publicationTime).getUTCFullYear();
          if (year >= 1000 && year <= 2100) result.publication_year = year;
        }
        if (Array.isArray(workNode.details.awardsWon) && workNode.details.awardsWon.length > 0) {
          result.awards = workNode.details.awardsWon
            .map((a) => normalizeWhitespace(a?.name || ''))
            .filter(Boolean)
            .slice(0, 5);
        }
      }

      if (workNode?.stats?.averageRating) {
        const avg = Number(workNode.stats.averageRating);
        if (Number.isFinite(avg) && avg > 0 && avg <= 5) {
          result.goodreads_rating = Math.round(avg * 100) / 100;
        }
      }
    } catch {
      // Ignore malformed __NEXT_DATA__
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function fetchAppleBooksMetadata(book) {
  const titleVariants = buildSearchTitleVariants(book.title);
  const authorLast =
    book.author && book.author !== 'Unknown Author'
      ? normalizeWhitespace(book.author).split(' ').pop()
      : '';

  for (const variant of titleVariants) {
    const term = authorLast ? `${variant} ${authorLast}` : variant;
    for (const country of ['us', 'gb']) {
      try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=ebook&country=${country}&limit=5`;
        const res = await httpGetWithRetry(url, { Accept: 'application/json' }, { timeoutMs: 10000, retries: 2 });
        if (res.status !== 200) continue;

        const json = JSON.parse(res.body);
        const results = Array.isArray(json.results) ? json.results : [];
        const hit = results.find(
          (item) =>
            (isTitleMatch(book.title, item.trackName || item.trackCensoredName || '') ||
              isTitleMatch(variant, item.trackName || item.trackCensoredName || '')) &&
            isSameAuthorClose(book.author, item.artistName || '')
        );
        if (!hit) continue;

        const parsed = {};
        const primaryArtist = normalizeWhitespace(String(hit.artistName || '').split(/&|,/)[0] || '');
        if (primaryArtist && (book.author === 'Unknown Author' || isSameAuthorClose(book.author, primaryArtist))) {
          parsed.author = primaryArtist;
        }

        if (hit.description) {
          const cleanedDesc = htmlToCleanMultilineText(hit.description);
          if (cleanedDesc && cleanedDesc.length > 40) {
            parsed.description = cleanedDesc;
          }
        }

        if (Array.isArray(hit.genres) && hit.genres.length > 0) {
          // Apple Books lists primary genres in the leading entries before trailing store-shelf tags
          const rawPrimary = hit.genres
            .slice(0, 6)
            .filter((g) => !/^books$/i.test(String(g || '').trim()));
          const mappedAll = canonicalizeGenresList(rawPrimary);
          const specificOnly = mappedAll.filter((g) => g !== 'Fiction');
          parsed.genres = specificOnly.length > 0 ? specificOnly.slice(0, 2) : mappedAll.slice(0, 2);
        }

        if (hit.releaseDate) {
          const year = new Date(hit.releaseDate).getUTCFullYear();
          if (Number.isFinite(year) && year >= 1800 && year <= 2100) {
            parsed.release_year = year;
          }
        }

        if (Object.keys(parsed).length > 0) return parsed;
      } catch {
        // Try next storefront/variant
      }
      await sleep(750);
    }
  }

  return null;
}

async function fetchGoodreadsAutoComplete(book) {
  const targetId = extractGoodreadsBookId(book.goodreads_url);
  const queries = [];
  if (book.author && book.author !== 'Unknown Author') {
    queries.push(`${book.title} ${book.author}`);
  }
  queries.push(book.title);

  for (const q of queries) {
    try {
      const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(q)}`;
      const res = await httpGetWithRetry(url, { Accept: 'application/json' }, { timeoutMs: 10000, retries: 1 });
      if (res.status !== 200) continue;
      const items = JSON.parse(res.body);
      if (!Array.isArray(items) || items.length === 0) continue;

      let match = targetId ? items.find((item) => String(item.bookId) === String(targetId)) : null;
      if (!match) {
        match = items.find(
          (item) =>
            isTitleMatch(book.title, item.bookTitleBare || item.title || '') &&
            isSameAuthorClose(book.author, item.author?.name || '')
        );
      }
      if (!match) continue;

      const parsed = {};
      if (match.author?.name && (book.author === 'Unknown Author' || isSameAuthorClose(book.author, match.author.name))) {
        parsed.author = normalizeWhitespace(match.author.name);
      }
      if (match.description?.html) {
        parsed.description = htmlToCleanMultilineText(match.description.html);
      }
      if (typeof match.numPages === 'number' && match.numPages > 0) {
        parsed.pages = Math.trunc(match.numPages);
      }
      if (match.avgRating) {
        const avg = Number(match.avgRating);
        if (Number.isFinite(avg) && avg > 0 && avg <= 5) {
          parsed.goodreads_rating = Math.round(avg * 100) / 100;
        }
      }
      if (match.imageUrl) {
        parsed.cover_url = upgradeGoodreadsCoverUrl(match.imageUrl);
      }
      if (Object.keys(parsed).length > 0) return parsed;
    } catch {
      // Try next query
    }
  }

  return null;
}

function extractYearFromDateString(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isTradePublisher(publisher) {
  if (!publisher || typeof publisher !== 'string') return false;
  return !SKIP_PUBLISHER_PATTERNS.some((re) => re.test(publisher));
}

function pickBestIsbn(isbnList) {
  if (!Array.isArray(isbnList)) return null;
  const clean = isbnList.map((s) => String(s).replace(/[^0-9Xx]/g, '')).filter(Boolean);
  return clean.find((s) => s.length === 13) || clean.find((s) => s.length === 10) || clean[0] || null;
}

function pickMatchingOpenLibraryDoc(docs, book, { expectedYear = null } = {}) {
  if (!Array.isArray(docs) || docs.length === 0) return null;

  for (const doc of docs) {
    if (!isTitleMatch(book.title, doc.title || '')) continue;

    const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
    const joinedAuthors = authors.join(' ');
    if (!joinedAuthors) continue;

    const authorMatches =
      isSameAuthorClose(book.author, joinedAuthors) || hasNonLatinScript(joinedAuthors);
    if (!authorMatches) continue;

    // Prevent attaching a completely unrelated older book with the same title
    if (
      expectedYear &&
      expectedYear >= 1995 &&
      typeof doc.first_publish_year === 'number' &&
      doc.first_publish_year > 0 &&
      expectedYear - doc.first_publish_year > 15
    ) {
      continue;
    }

    return doc;
  }

  return null;
}

function pickBestEnglishEdition(editions, { allowMalayFallback = false } = {}) {
  if (!Array.isArray(editions) || editions.length === 0) return null;

  let bestScore = -1;
  let bestEd = null;

  for (const ed of editions) {
    const langs = Array.isArray(ed.languages) ? ed.languages.map((l) => l.key || '') : [];
    const hasExplicitEng = langs.some((k) => k.endsWith('/eng'));
    const hasExplicitMalay = langs.some((k) => k.endsWith('/msa') || k.endsWith('/may'));
    const isEnglishLang = langs.length === 0 || hasExplicitEng;
    if (!isEnglishLang && !(allowMalayFallback && hasExplicitMalay)) continue;

    const pub = Array.isArray(ed.publishers) ? ed.publishers[0] || '' : '';
    if (pub && !isTradePublisher(pub)) continue;

    const isbn = pickBestIsbn([...(ed.isbn_13 || []), ...(ed.isbn_10 || [])]);
    const isEnglishGroupIsbn = Boolean(isbn && /^(9780|9781|9798|0|1)/.test(isbn));
    const isMalayGroupIsbn = Boolean(isbn && /^(978983|978967)/.test(isbn));
    if (langs.length === 0 && !isEnglishGroupIsbn && !(allowMalayFallback && isMalayGroupIsbn)) {
      continue;
    }

    let score = 0;
    if (isEnglishGroupIsbn) score += 6;
    if (isbn && isbn.length === 13) score += 4;
    else if (isbn) score += 2;
    if (pub) score += 3;
    if (hasExplicitEng) score += 4;
    if (typeof ed.number_of_pages === 'number' && ed.number_of_pages > 0) score += 1;
    if (extractYearFromDateString(ed.publish_date)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestEd = {
        isbn,
        publisher: pub ? normalizeWhitespace(pub) : null,
        pages: typeof ed.number_of_pages === 'number' && ed.number_of_pages > 0 ? Math.trunc(ed.number_of_pages) : null,
        year: extractYearFromDateString(ed.publish_date),
        language: hasExplicitEng || isEnglishGroupIsbn ? 'English' : hasExplicitMalay ? 'Malay' : null,
      };
    }
  }

  return bestEd;
}

async function fetchOpenLibraryMetadata(book, { needsDescription = false, expectedYear = null } = {}) {
  try {
    const fields =
      'key,title,author_name,subject,first_publish_year,isbn,number_of_pages_median,publisher,language';
    const cleanTitle = normalizeMatchText(stripTitleSubtitle(book.title));
    const authorLast =
      book.author && book.author !== 'Unknown Author'
        ? normalizeWhitespace(book.author).split(' ').pop()
        : '';

    const candidateUrls = [];
    if (authorLast) {
      const p1 = new URLSearchParams({ title: stripTitleSubtitle(book.title), author: authorLast, limit: '5', fields });
      candidateUrls.push(`https://openlibrary.org/search.json?${p1.toString()}`);
      const p2 = new URLSearchParams({ q: `${cleanTitle} ${authorLast}`, limit: '5', fields });
      candidateUrls.push(`https://openlibrary.org/search.json?${p2.toString()}`);
    }
    const p3 = new URLSearchParams({ title: cleanTitle || book.title, limit: '5', fields });
    candidateUrls.push(`https://openlibrary.org/search.json?${p3.toString()}`);

    let doc = null;
    for (const searchUrl of candidateUrls) {
      const searchRes = await httpGetWithRetry(
        searchUrl,
        { Accept: 'application/json' },
        { timeoutMs: 12000, retries: 2 }
      );
      if (searchRes.status !== 200) continue;
      const searchJson = JSON.parse(searchRes.body);
      doc = pickMatchingOpenLibraryDoc(searchJson.docs, book, { expectedYear });
      if (doc) break;
    }

    if (!doc) return null;

    const meta = {};
    if (Array.isArray(doc.author_name) && isLatinReadableAuthor(doc.author_name[0])) {
      meta.author = normalizeWhitespace(doc.author_name[0]);
    }

    const docGenres = canonicalizeGenresList(doc.subject, { allowFallbackFiction: false });
    if (docGenres.length > 0) meta.genres = docGenres;

    if (typeof doc.first_publish_year === 'number' && doc.first_publish_year > 0) {
      meta.publication_year = Math.trunc(doc.first_publish_year);
    }
    if (typeof doc.number_of_pages_median === 'number' && doc.number_of_pages_median > 0) {
      meta.pages = Math.trunc(doc.number_of_pages_median);
    }

    // Fetch clean English trade edition from /works/{key}/editions.json
    if (doc.key) {
      try {
        const edListRes = await httpGetWithRetry(
          `https://openlibrary.org${doc.key}/editions.json?limit=35`,
          { Accept: 'application/json' },
          { timeoutMs: 10000, retries: 1 }
        );
        if (edListRes.status === 200) {
          const edListJson = JSON.parse(edListRes.body);
          const bestEd = pickBestEnglishEdition(edListJson.entries, {
            allowMalayFallback: book.slug === 'tunggu-teduh-dulu',
          });
          if (bestEd) {
            if (bestEd.isbn) meta.isbn = bestEd.isbn;
            if (bestEd.publisher) meta.publisher = bestEd.publisher;
            if (bestEd.pages && !meta.pages) meta.pages = bestEd.pages;
            if (bestEd.language) meta.language = bestEd.language;
            if (!meta.publication_year && bestEd.year) meta.publication_year = bestEd.year;
          }
        }
      } catch {
        // Ignore editions fetch error
      }
    }

    if (!meta.isbn) {
      const fallbackIsbn = pickBestIsbn(doc.isbn);
      if (fallbackIsbn) meta.isbn = fallbackIsbn;
    }
    if (!meta.publisher && Array.isArray(doc.publisher)) {
      const tradePub = doc.publisher.find(isTradePublisher);
      if (tradePub) meta.publisher = normalizeWhitespace(tradePub);
    }
    if (!meta.language && Array.isArray(doc.language) && doc.language[0]) {
      const langCodes = doc.language.map((l) => String(l).toLowerCase());
      const preferredCode = langCodes.find((c) => c === 'eng' || c === 'en') || langCodes[0];
      meta.language = OPENLIBRARY_LANGUAGE_MAP[preferredCode] || normalizeWhitespace(preferredCode);
    }

    // Fetch work description & subjects if still needed
    if ((needsDescription || !meta.genres?.length) && doc.key) {
      try {
        const workRes = await httpGetWithRetry(
          `https://openlibrary.org${doc.key}.json`,
          { Accept: 'application/json' },
          { timeoutMs: 10000, retries: 1 }
        );
        if (workRes.status === 200) {
          const workJson = JSON.parse(workRes.body);
          const descVal =
            typeof workJson.description === 'string'
              ? workJson.description
              : workJson.description?.value || null;
          if (descVal) {
            const cleanedDesc = normalizeMultilineText(
              descVal
                .replace(/\[.*?\]\(https?:\/\/.*?\)/g, '')
                .replace(/\(\[Source\][\s\S]*$/i, '')
                .replace(/--From Goodreads.*$/i, '')
            );
            if (cleanedDesc && cleanedDesc.length > 40) {
              meta.description = cleanedDesc;
            }
          }
          if (!meta.genres?.length && Array.isArray(workJson.subjects)) {
            const workGenres = canonicalizeGenresList(workJson.subjects, { allowFallbackFiction: false });
            if (workGenres.length > 0) meta.genres = workGenres;
          }
        }
      } catch {
        // Ignore work lookup failure
      }
    }

    return Object.keys(meta).length > 0 ? meta : null;
  } catch {
    return null;
  }
}

function normalizeBookFormat(rawFormat, formatMap = {}) {
  if (!rawFormat) return null;
  const key = normalizeWhitespace(String(rawFormat)).toLowerCase();
  return formatMap[key] || normalizeWhitespace(String(rawFormat));
}

function hasCompleteEnrichment(book) {
  if (!book || !book.description) return false;
  if (!Array.isArray(book.genres)) return false;
  const cleanGenres = canonicalizeGenresList(book.genres);
  if (cleanGenres.length !== book.genres.length) return false;
  return Boolean(
    book.goodreads_rating ||
      (!isTruncatedText(book.description) && cleanGenres.length > 0 && book.isbn && book.pages && book.publisher)
  );
}

async function fetchSingleBookMetadata(book, { formatMap = {}, wafState = { trips: 0 } } = {}) {
  // 1. Apple Books API (fast, reliable JSON: full publisher synopsis + accurate literary genres + release year)
  const appleMeta = await fetchAppleBooksMetadata(book);

  // 2. Goodreads auto_complete API (canonical Goodreads author, exact pages, Goodreads rating, cover, fallback blurb)
  const grAcMeta = await fetchGoodreadsAutoComplete(book);

  // 3. Goodreads HTML (only when missing genres or full description, and WAF hasn't tripped)
  let grHtmlMeta = null;
  const needsGrHtml = !appleMeta?.genres?.length || !appleMeta?.description;
  if (book.goodreads_url && needsGrHtml && wafState.trips < 2) {
    try {
      const res = await httpGetIpv4(
        book.goodreads_url,
        {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
        { timeoutMs: 12000 }
      );
      if (res.status === 200 && res.body.includes('__NEXT_DATA__')) {
        grHtmlMeta = parseGoodreadsHtml(res.body);
        wafState.trips = 0;
      } else if (res.status === 202 || res.status === 403 || res.status === 429) {
        wafState.trips += 1;
      }
    } catch {
      // Ignore WAF/network errors gracefully
    }
  }

  // 4. Strictly verified Open Library (trade ISBN, English publisher, original pub year, language, fallback full work synopsis)
  const needsDescription = !grHtmlMeta?.description && !appleMeta?.description;
  const olMeta = await fetchOpenLibraryMetadata(
    {
      ...book,
      author: grHtmlMeta?.author || grAcMeta?.author || appleMeta?.author || book.author,
    },
    {
      needsDescription,
      expectedYear: appleMeta?.release_year || null,
    }
  );

  // Merge genres cleanly: Goodreads HTML -> Apple Books -> clean Open Library
  const mergedGenres = canonicalizeGenresList([
    ...(grHtmlMeta?.genres || []),
    ...(appleMeta?.genres || []),
    ...(olMeta?.genres || []),
  ]);

  // Merge synopsis cleanly: Goodreads HTML full -> Apple Books full -> Open Library work full -> Goodreads snippet
  let bestDescription =
    book.description && !isTruncatedText(book.description) && book.description.length > 150
      ? book.description
      : null;
  if (!bestDescription) {
    const candidates = [
      grHtmlMeta?.description,
      appleMeta?.description,
      olMeta?.description,
      grAcMeta?.description,
      book.description,
    ].filter(Boolean);
    bestDescription =
      candidates.find((d) => !isTruncatedText(d) && d.length > 140) ||
      candidates.find((d) => !isTruncatedText(d)) ||
      candidates[0] ||
      null;
  }

  // Merge canonical author
  let resolvedAuthor = book.author;
  if (grHtmlMeta?.author) {
    resolvedAuthor = grHtmlMeta.author;
  } else if (grAcMeta?.author) {
    resolvedAuthor = grAcMeta.author;
  } else if (
    appleMeta?.author &&
    (book.author === 'Unknown Author' || isSameAuthorClose(book.author, appleMeta.author))
  ) {
    resolvedAuthor = appleMeta.author;
  } else if (
    olMeta?.author &&
    (book.author === 'Unknown Author' || isSameAuthorClose(book.author, olMeta.author))
  ) {
    resolvedAuthor = olMeta.author;
  }

  // Preserve Notion-curated genres if already present on the incoming Notion row, otherwise use enriched genres
  const finalGenres = book.genres?.length ? canonicalizeGenresList(book.genres) : mergedGenres;

  // Prefer Apple Books release year if OpenLibrary matched an unrelated older year (> 5 yrs earlier for modern books)
  let resolvedYear =
    book.publication_year ||
    grHtmlMeta?.publication_year ||
    olMeta?.publication_year ||
    appleMeta?.release_year ||
    null;
  if (
    !book.publication_year &&
    !grHtmlMeta?.publication_year &&
    appleMeta?.release_year >= 2005 &&
    olMeta?.publication_year &&
    appleMeta.release_year - olMeta.publication_year > 5
  ) {
    resolvedYear = appleMeta.release_year;
  }

  return {
    author: resolvedAuthor,
    genres: finalGenres,
    description: bestDescription,
    isbn: book.isbn || grHtmlMeta?.isbn || olMeta?.isbn || null,
    pages: book.pages || grHtmlMeta?.pages || grAcMeta?.pages || olMeta?.pages || null,
    publisher: book.publisher || grHtmlMeta?.publisher || olMeta?.publisher || null,
    publication_year: resolvedYear,
    language: book.language || grHtmlMeta?.language || olMeta?.language || null,
    original_title: book.original_title || grHtmlMeta?.original_title || null,
    series: book.series || grHtmlMeta?.series || null,
    awards: book.awards?.length ? book.awards : grHtmlMeta?.awards || [],
    goodreads_rating:
      book.goodreads_rating || grHtmlMeta?.goodreads_rating || grAcMeta?.goodreads_rating || null,
    format:
      book.format ||
      normalizeBookFormat(grHtmlMeta?.format, formatMap) ||
      null,
    cover_url:
      book.cover_url || grHtmlMeta?.cover_url || grAcMeta?.cover_url || null,
  };
}

export async function enrichBooksMetadata(
  books,
  {
    existingBooks = [],
    formatMap = {},
    forceRefresh = process.env.FORCE_METADATA_REFRESH === 'true',
    concurrency = 1,
    onProgress = null,
  } = {}
) {
  const existingByPageId = new Map();
  const existingByGrUrl = new Map();
  for (const prev of existingBooks) {
    if (prev.notion_page_id) existingByPageId.set(prev.notion_page_id, prev);
    if (prev.goodreads_url) existingByGrUrl.set(prev.goodreads_url, prev);
  }

  const enriched = new Array(books.length);
  const wafState = { trips: 0 };
  let cursor = 0;
  let fetchedCount = 0;
  let reusedCount = 0;

  async function worker() {
    while (cursor < books.length) {
      const idx = cursor;
      cursor += 1;
      const book = books[idx];
      const prev =
        (book.notion_page_id && existingByPageId.get(book.notion_page_id)) ||
        (book.goodreads_url && existingByGrUrl.get(book.goodreads_url)) ||
        null;

      const sameGrUrl =
        !book.goodreads_url || !prev?.goodreads_url || prev.goodreads_url === book.goodreads_url;
      const prevCleanGenres = prev ? canonicalizeGenresList(prev.genres) : [];
      const prevHasComplete = prev && hasCompleteEnrichment({ ...prev, genres: prevCleanGenres });

      if (!forceRefresh && prevHasComplete && sameGrUrl) {
        enriched[idx] = {
          ...book,
          author: prev.author || book.author,
          genres: book.genres?.length ? canonicalizeGenresList(book.genres) : prevCleanGenres,
          description: book.description || prev.description || null,
          isbn: book.isbn || prev.isbn || null,
          pages: book.pages || prev.pages || null,
          publisher: book.publisher || prev.publisher || null,
          publication_year: book.publication_year || prev.publication_year || null,
          language: book.language || prev.language || null,
          original_title: book.original_title || prev.original_title || null,
          series: book.series || prev.series || null,
          awards: book.awards?.length ? book.awards : prev.awards || [],
          goodreads_rating: book.goodreads_rating || prev.goodreads_rating || null,
          format: book.format || prev.format || null,
          cover_url: book.cover_url || prev.cover_url || null,
        };
        reusedCount += 1;
        if (onProgress) {
          onProgress(fetchedCount + reusedCount, books.length, book.title);
        }
        continue;
      }

      // Pass a clean Notion-level seed (don't carry over stale noisy genres/pubs on refresh)
      const fetched = await fetchSingleBookMetadata(book, { formatMap, wafState });
      enriched[idx] = {
        ...book,
        ...fetched,
      };
      fetchedCount += 1;
      if (onProgress) {
        onProgress(fetchedCount + reusedCount, books.length, book.title);
      }
      await sleep(450);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  return {
    books: enriched,
    fetchedCount,
    reusedCount,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const libraryPath = path.resolve(process.cwd(), 'data/library.json');
  const existing = readJsonSafe(libraryPath);
  if (!existing || !Array.isArray(existing.books)) {
    console.error('data/library.json missing or invalid.');
    process.exit(1);
  }
  const config = loadMappingConfig();
  const forceRefresh = process.argv.includes('--force');
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const onlySlugs = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  const stripForRefetch = (b) => ({
    ...b,
    genres: [],
    description: null,
    isbn: null,
    publisher: null,
    publication_year: null,
    language: null,
    original_title: null,
    series: null,
    awards: [],
    goodreads_rating: null,
  });

  // When running standalone --force or --only, strip previously scraped fields on target books while keeping Notion baseline + reviews
  const seedBooks = existing.books.map((b) =>
    forceRefresh || (onlySlugs && onlySlugs.has(b.slug)) ? stripForRefetch(b) : b
  );
  const existingForRun = forceRefresh
    ? []
    : onlySlugs
      ? existing.books.filter((b) => !onlySlugs.has(b.slug))
      : existing.books;

  console.log(`Enriching ${seedBooks.length} books from Apple Books, Goodreads & Open Library...`);
  const { books: enrichedRaw, fetchedCount, reusedCount } = await enrichBooksMetadata(seedBooks, {
    existingBooks: existingForRun,
    formatMap: config.formatMap || {},
    forceRefresh,
    concurrency: 1,
    onProgress: (done, total, title) => {
      if (done % 15 === 0 || done === total) {
        console.log(`Progress: ${done}/${total} (${title})`);
      }
    },
  });
  const { books, warnings } = validateAndSanitiseBooks(enrichedRaw, config);
  for (const w of warnings) console.warn(`Validation warning: ${w}`);
  books.sort((a, b) => a.slug.localeCompare(b.slug));
  writeJsonAtomic(libraryPath, {
    ...existing,
    last_updated: new Date().toISOString(),
    total_books: books.length,
    books,
  });
  console.log(
    `Enrichment complete: fetched=${fetchedCount}, reused=${reusedCount}, total=${books.length}`
  );
}
