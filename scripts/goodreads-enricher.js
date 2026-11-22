import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndSanitiseBooks } from './data-validator.js';
import { loadMappingConfig } from './notion-mapper.js';
import { normalizeMultilineText, normalizeWhitespace, readJsonSafe, sleep, writeJsonAtomic } from './utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

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

const NOISY_SUBJECT_PATTERNS = [
  /nyt:/i,
  /new york times/i,
  /accessible book/i,
  /protected daisy/i,
  /in library/i,
  /internet archive/i,
  /open library/i,
  /reading level/i,
  /large type/i,
  /large print/i,
  /overdrive/i,
  /staff picks/i,
  /award/i,
  /bestseller/i,
  /best seller/i,
  /collectionid/i,
  /general$/i,
  /^juvenile/i,
  /translations into/i,
  /specimens/i,
  /^audiobooks?$/i,
  /^ficcion$/i,
  /^historia$/i,
  /^ancianos$/i,
  /guerra mundial/i,
  /,\s*fiction$/i,
  /^adult$/i,
  /^general fiction$/i,
  /^imaginary places$/i,
  /^curiosities and wonders$/i,
  /^dwellings$/i,
  /^duchies$/i,
  /^receptionists$/i,
  /^retail stores$/i,
  /^atheists$/i,
  /^counseling$/i,
  /^multiple timelines$/i,
  /^books about books$/i,
  /^older men$/i,
  /^young women$/i,
  /^teenage (boys|girls)$/i,
  /^interpersonal relations$/i,
  /^man-woman relationships/i,
  /^life change events$/i,
  /^human rights/i,
  /^civil rights/i,
  /^politics and government$/i,
  /^great britain$/i,
  /^idaho$/i,
  /^italy$/i,
  /^korea$/i,
  /^poland$/i,
  /^japan$/i,
  /^asia$/i,
  /^dead$/i,
  /^space$/i,
  /^space and time$/i,
  /^space colonies$/i,
  /^language and languages$/i,
  /^underground movements$/i,
  /^collaborationists$/i,
  /^civilians in war$/i,
  /^women in war$/i,
  /^women authors$/i,
  /^women rock musicians$/i,
  /^musicians$/i,
  /^mothers of murder victims$/i,
  /^sexual minorities$/i,
  /^arab-israeli conflict$/i,
  /^palestinian/i,
  /^dunkirk evacuation$/i,
  /^marie curie$/i,
  /^ali hazelwood$/i,
  /^love hypothesis$/i,
  /^love on the brain$/i,
  /^dune$/i,
  /^atonement$/i,
  /^reality$/i,
  /^technological$/i,
  /^fear$/i,
  /^lust$/i,
  /^race$/i,
  /^father(s)?$/i,
  /^brotherhood$/i,
  /^community life$/i,
  /^family life$/i,
  /^families$/i,
  /^brothers and sisters$/i,
  /^mothers and daughters$/i,
  /^fathers and daughters$/i,
  /^cold cases$/i,
  /^police$/i,
  /^investigation$/i,
  /^murderers$/i,
  /^assassins$/i,
  /^kidnapping$/i,
  /^epidemics$/i,
  /^translators$/i,
  /^chinese$/i,
  /^imperialism$/i,
  /^summer$/i,
  /^gods$/i,
  /^goddesses$/i,
  /^dragons$/i,
  /^courts and courtiers$/i,
  /^labyrinths$/i,
  /^magic$/i,
  /^epic$/i,
];

const GENRE_SYNONYM_MAP = {
  'fiction': 'Fiction',
  'literary': 'Literary Fiction',
  'literary fiction': 'Literary Fiction',
  'contemporary': 'Contemporary Fiction',
  'contemporary fiction': 'Contemporary Fiction',
  'contemporary women': 'Contemporary Fiction',
  'womens fiction': 'Contemporary Fiction',
  "women's fiction": 'Contemporary Fiction',
  'women': 'Contemporary Fiction',
  'mystery': 'Mystery',
  'mystery thriller': 'Mystery',
  'thriller': 'Thriller',
  'suspense': 'Thriller',
  'psychological': 'Psychological Fiction',
  'psychological fiction': 'Psychological Fiction',
  'psychological thriller': 'Thriller',
  'crime': 'Crime',
  'murder': 'Crime',
  'mystery & detective': 'Mystery',
  'police procedural': 'Crime',
  'historical': 'Historical Fiction',
  'historical fiction': 'Historical Fiction',
  'history': 'History',
  'war & military': 'War Fiction',
  'world war, 1939-1945': 'War Fiction',
  'fantasy': 'Fantasy',
  'science fiction': 'Science Fiction',
  'science-fiction': 'Science Fiction',
  'sci fi': 'Science Fiction',
  'sci-fi': 'Science Fiction',
  'dystopia': 'Dystopian',
  'dystopian': 'Dystopian',
  'magical realism': 'Magical Realism',
  'romance': 'Romance',
  'romance literature': 'Romance',
  'contemporary romance': 'Romance',
  'historical romance': 'Historical Romance',
  'enemies to lovers': 'Romance',
  'love': 'Romance',
  'young adult': 'Young Adult',
  'young adult fiction': 'Young Adult',
  'teen & young adult': 'Young Adult',
  'coming of age': 'Coming of Age',
  'horror': 'Horror',
  'gothic': 'Gothic',
  'classics': 'Classics',
  'classic': 'Classics',
  'japanese literature': 'Japanese Literature',
  'japanese fiction': 'Japanese Literature',
  'japanese short stories': 'Japanese Literature',
  'literatura japonesa': 'Japanese Literature',
  'asian literature': 'Asian Literature',
  'american literature': 'American Literature',
  'english literature': 'English Literature',
  'european fiction': 'European Fiction',
  'short stories': 'Short Stories',
  'nonfiction': 'Nonfiction',
  'non-fiction': 'Nonfiction',
  'memoir': 'Memoir',
  'biography': 'Biography',
  'autobiography': 'Memoir',
  'essays': 'Essays',
  'poetry': 'Poetry',
  'mythology': 'Mythology',
  'retellings': 'Mythology',
  'lgbt': 'LGBTQ+',
  'lgbtq': 'LGBTQ+',
  'lgbtq+': 'LGBTQ+',
  'lgbtq novels': 'LGBTQ+',
  'gay': 'LGBTQ+',
  'lesbians': 'LGBTQ+',
  'queer': 'LGBTQ+',
  'time travel': 'Time Travel',
  'time-traveling': 'Time Travel',
  'epistolary': 'Epistolary',
  'family': 'Family Saga',
  'family life': 'Family Saga',
  'family saga': 'Family Saga',
  'sagas': 'Family Saga',
  'dysfunctional families': 'Family Saga',
  'domestic fiction': 'Domestic Fiction',
  'marriage': 'Domestic Fiction',
  'grief': 'Literary Fiction',
  'friendship': 'Contemporary Fiction',
  'survival': 'Adventure',
  'adventure': 'Adventure',
  'music': 'Music Fiction',
  'pianists': 'Music Fiction',
  'political': 'Political Fiction',
  'comics & graphic novels, literary': 'Graphic Novel',
  'graphic novels': 'Graphic Novel',
};

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

async function httpGetWithRetry(url, extraHeaders = {}, { timeoutMs = 12000, retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await httpGetIpv4(url, extraHeaders, { timeoutMs });
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        if (attempt < retries) {
          await sleep(450 * (attempt + 1));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(450 * (attempt + 1));
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
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number.parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    });
}

function htmlToCleanMultilineText(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return null;
  const withBreaks = decodeHtmlEntities(rawHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
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
  const b = normalizeMatchText(candidateAuthor);
  if (!a || a === 'unknown author') return true;
  if (!b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const aTokens = a.split(' ');
  const bTokens = b.split(' ');
  const aLast = aTokens[aTokens.length - 1];
  const bLast = bTokens[bTokens.length - 1];
  if (aLast === bLast) return true;
  if (aLast.length >= 4 && bLast.length >= 4 && levenshtein(aLast, bLast) <= 2) {
    if (aTokens.length === 1 || bTokens.length === 1) return true;
    return aTokens[0] === bTokens[0] || levenshtein(aTokens[0], bTokens[0]) <= 1;
  }
  return false;
}

function isLatinReadableAuthor(name) {
  if (!name || typeof name !== 'string') return false;
  return /[a-zA-Z]{2,}/.test(name);
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

function canonicalizeGenresList(rawGenres, book = null) {
  if (!Array.isArray(rawGenres)) return [];
  const normBookTitle = normalizeMatchText(book?.title || '');
  const normBookAuthor = normalizeMatchText(book?.author || '');
  const seen = new Set();
  const specific = [];
  const generic = [];

  const expandedRaw = [];
  for (const raw of rawGenres) {
    const rawStr = normalizeWhitespace(String(raw || ''));
    if (rawStr.includes('/')) {
      for (const part of rawStr.split('/')) {
        if (part.trim()) expandedRaw.push(part.trim());
      }
    } else if (/^fiction\s*,\s*/i.test(rawStr) && rawStr.includes(',')) {
      for (const part of rawStr.replace(/^fiction\s*,\s*/i, '').split(',')) {
        if (part.trim()) expandedRaw.push(part.trim());
      }
    } else {
      expandedRaw.push(rawStr);
    }
  }

  for (const raw of expandedRaw) {
    let clean = normalizeWhitespace(raw)
      .replace(/\s*\(.*?\)\s*$/, '')
      .trim();
    if (!clean || clean.length < 3 || clean.length > 36) continue;
    if (clean.includes('--') || clean.includes(':')) continue;

    const cleanMatch = normalizeMatchText(clean);
    if (!cleanMatch) continue;
    if (normBookTitle && (cleanMatch === normBookTitle || (normBookTitle.includes(cleanMatch) && cleanMatch.length > 6))) {
      continue;
    }
    if (normBookAuthor && cleanMatch === normBookAuthor) continue;

    if (NOISY_SUBJECT_PATTERNS.some((re) => re.test(clean))) continue;
    if (/^[a-z]+,\s+[a-z]+$/i.test(clean)) {
      clean = clean.split(',')[0].trim();
    }

    const mapped = GENRE_SYNONYM_MAP[clean.toLowerCase()] || GENRE_SYNONYM_MAP[cleanMatch];
    if (!mapped) {
      continue;
    }
    const key = mapped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (mapped === 'Fiction') {
      generic.push(mapped);
    } else {
      specific.push(mapped);
    }
  }

  const ordered = specific.length > 0 ? specific : generic;
  return ordered.slice(0, 5);
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
      // Ignore malformed __NEXT_DATA__ and fall through to LD+JSON
    }
  }

  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]);
      if (!result.author && Array.isArray(ld.author) && ld.author[0]?.name) {
        result.author = normalizeWhitespace(ld.author[0].name);
      } else if (!result.author && ld.author?.name) {
        result.author = normalizeWhitespace(ld.author.name);
      }
      if (!result.isbn && ld.isbn) {
        result.isbn = normalizeWhitespace(String(ld.isbn));
      }
      if (!result.pages && typeof ld.numberOfPages === 'number' && ld.numberOfPages > 0) {
        result.pages = Math.trunc(ld.numberOfPages);
      }
      if (!result.language && ld.inLanguage) {
        result.language = normalizeWhitespace(ld.inLanguage);
      }
      if (!result.format && ld.bookFormat) {
        result.format = normalizeWhitespace(ld.bookFormat);
      }
      if (!result.cover_url && ld.image) {
        result.cover_url = upgradeGoodreadsCoverUrl(ld.image);
      }
      if (!result.goodreads_rating && ld.aggregateRating?.ratingValue) {
        const avg = Number(ld.aggregateRating.ratingValue);
        if (Number.isFinite(avg) && avg > 0 && avg <= 5) {
          result.goodreads_rating = Math.round(avg * 100) / 100;
        }
      }
      if (!result.awards && typeof ld.awards === 'string' && ld.awards.trim()) {
        result.awards = ld.awards
          .split(',')
          .map((s) => normalizeWhitespace(s))
          .filter(Boolean)
          .slice(0, 5);
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function fetchGoodreadsAutoComplete(book) {
  const targetId = extractGoodreadsBookId(book.goodreads_url);
  const queries = [book.title];
  if (book.author && book.author !== 'Unknown Author') {
    queries.push(`${book.title} ${book.author}`);
  }

  const normBookTitle = normalizeMatchText(book.title);

  for (const q of queries) {
    try {
      const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${encodeURIComponent(q)}`;
      const res = await httpGetWithRetry(url, { Accept: 'application/json' }, { timeoutMs: 10000, retries: 1 });
      if (res.status !== 200) continue;
      const items = JSON.parse(res.body);
      if (!Array.isArray(items) || items.length === 0) continue;

      let match = targetId ? items.find((item) => String(item.bookId) === String(targetId)) : null;
      if (!match) {
        match = items.find((item) => {
          const itemTitle = normalizeMatchText(item.bookTitleBare || item.title || '');
          const itemAuthor = item.author?.name || '';
          const titleOk =
            itemTitle === normBookTitle ||
            (normBookTitle.length >= 6 && (itemTitle.includes(normBookTitle) || normBookTitle.includes(itemTitle)));
          return titleOk && isSameAuthorClose(book.author, itemAuthor);
        });
      }
      if (!match) {
        match = items.find((item) => {
          const itemTitle = normalizeMatchText(item.bookTitleBare || item.title || '');
          return itemTitle === normBookTitle;
        });
      }
      if (!match) continue;

      const parsed = {};
      if (match.author?.name && isSameAuthorClose(book.author, match.author.name)) {
        parsed.author = normalizeWhitespace(match.author.name);
      } else if (match.author?.name && book.author === 'Unknown Author') {
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

function pickBestIsbn(isbnList) {
  if (!Array.isArray(isbnList)) return null;
  const clean = isbnList.map((s) => String(s).replace(/[^0-9Xx]/g, '')).filter(Boolean);
  return clean.find((s) => s.length === 13) || clean.find((s) => s.length === 10) || clean[0] || null;
}

function pickMatchingOpenLibraryDoc(docs, book) {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const normBookTitle = normalizeMatchText(book.title);

  for (const doc of docs) {
    const docTitle = normalizeMatchText(doc.title || '');
    const titleMatches =
      docTitle === normBookTitle ||
      docTitle.startsWith(normBookTitle) ||
      normBookTitle.startsWith(docTitle) ||
      (normBookTitle.length >= 8 && docTitle.includes(normBookTitle));
    if (!titleMatches) continue;

    const docAuthor = Array.isArray(doc.author_name) ? doc.author_name.join(' ') : '';
    if (isSameAuthorClose(book.author, docAuthor) || !isLatinReadableAuthor(docAuthor)) {
      return doc;
    }
  }

  return null;
}

async function fetchOpenLibraryMetadata(book, needs = {}) {
  try {
    const fields =
      'key,title,author_name,subject,first_publish_year,isbn,number_of_pages_median,publisher,language,edition_key';
    const cleanTitle = normalizeMatchText(book.title);
    const authorLast =
      book.author && book.author !== 'Unknown Author'
        ? normalizeWhitespace(book.author).split(' ').pop()
        : '';

    const candidateUrls = [];
    if (authorLast) {
      const p1 = new URLSearchParams({ title: book.title, author: authorLast, limit: '4', fields });
      candidateUrls.push(`https://openlibrary.org/search.json?${p1.toString()}`);
      const p2 = new URLSearchParams({ q: `${cleanTitle} ${authorLast}`, limit: '4', fields });
      candidateUrls.push(`https://openlibrary.org/search.json?${p2.toString()}`);
    }
    const p3 = new URLSearchParams({ title: cleanTitle || book.title, limit: '4', fields });
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
      doc = pickMatchingOpenLibraryDoc(searchJson.docs, book);
      if (doc) break;
    }

    if (!doc) return null;

    const meta = {};
    if (Array.isArray(doc.author_name) && isLatinReadableAuthor(doc.author_name[0])) {
      meta.author = normalizeWhitespace(doc.author_name[0]);
    }
    const genres = canonicalizeGenresList(doc.subject, book);
    if (genres.length > 0) meta.genres = genres;
    if (typeof doc.first_publish_year === 'number' && doc.first_publish_year > 0) {
      meta.publication_year = Math.trunc(doc.first_publish_year);
    }
    if (typeof doc.number_of_pages_median === 'number' && doc.number_of_pages_median > 0) {
      meta.pages = Math.trunc(doc.number_of_pages_median);
    }
    const isbn = pickBestIsbn(doc.isbn);
    if (isbn) meta.isbn = isbn;
    if (Array.isArray(doc.publisher) && doc.publisher[0]) {
      meta.publisher = normalizeWhitespace(doc.publisher[0]);
    }
    if (Array.isArray(doc.language) && doc.language[0]) {
      const langCode = String(doc.language[0]).toLowerCase();
      meta.language = OPENLIBRARY_LANGUAGE_MAP[langCode] || normalizeWhitespace(doc.language[0]);
    }

    if ((needs.description || !meta.genres?.length) && doc.key) {
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
              descVal.replace(/\[.*?\]\(https?:\/\/.*?\)/g, '').replace(/\(\[Source\][\s\S]*$/i, '')
            );
            if (cleanedDesc && cleanedDesc.length > 25) {
              meta.description = cleanedDesc;
            }
          }
          if (!meta.genres?.length && Array.isArray(workJson.subjects)) {
            const workGenres = canonicalizeGenresList(workJson.subjects, book);
            if (workGenres.length > 0) meta.genres = workGenres;
          }
        }
      } catch {
        // Ignore work lookup failure
      }
    }

    if ((!meta.isbn || !meta.pages || !meta.publisher) && Array.isArray(doc.edition_key) && doc.edition_key[0]) {
      try {
        const edRes = await httpGetWithRetry(
          `https://openlibrary.org/books/${encodeURIComponent(doc.edition_key[0])}.json`,
          { Accept: 'application/json' },
          { timeoutMs: 10000, retries: 1 }
        );
        if (edRes.status === 200) {
          const ed = JSON.parse(edRes.body);
          if (!meta.isbn) {
            meta.isbn = pickBestIsbn([...(ed.isbn_13 || []), ...(ed.isbn_10 || [])]);
          }
          if (!meta.pages && typeof ed.number_of_pages === 'number' && ed.number_of_pages > 0) {
            meta.pages = Math.trunc(ed.number_of_pages);
          }
          if (!meta.publisher && Array.isArray(ed.publishers) && ed.publishers[0]) {
            meta.publisher = normalizeWhitespace(ed.publishers[0]);
          }
          if (!meta.publication_year && ed.publish_date) {
            const yr = extractYearFromDateString(ed.publish_date);
            if (yr) meta.publication_year = yr;
          }
        }
      } catch {
        // Ignore edition lookup failure
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

function isTruncatedText(text) {
  return typeof text === 'string' && /(\.\.\.|…)\s*$/.test(text.trim());
}

function hasCompleteEnrichment(book) {
  if (!book || !book.description) return false;
  if (!Array.isArray(book.genres)) return false;
  const cleanGenres = canonicalizeGenresList(book.genres, book);
  if (cleanGenres.length !== book.genres.length) return false;
  // Already enriched in a previous pass if it has Goodreads rating or full catalog fields
  return Boolean(
    book.goodreads_rating ||
      (!isTruncatedText(book.description) && cleanGenres.length > 0 && book.isbn && book.pages && book.publisher)
  );
}

async function fetchSingleBookMetadata(book, { formatMap = {}, wafState = { trips: 0 } } = {}) {
  let grHtmlMeta = null;

  if (book.goodreads_url && wafState.trips < 2) {
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
      // Fall back to auto_complete + OpenLibrary
    }
  }

  let grAcMeta = null;
  const needsCoreGr = !grHtmlMeta || !grHtmlMeta.description || !grHtmlMeta.author;
  if (needsCoreGr) {
    grAcMeta = await fetchGoodreadsAutoComplete(book);
  }

  const combinedGr = {
    ...(grAcMeta || {}),
    ...(grHtmlMeta || {}),
  };
  if (grAcMeta?.description && !combinedGr.description) {
    combinedGr.description = grAcMeta.description;
  }

  const needsOl =
    !combinedGr.genres?.length ||
    !combinedGr.isbn ||
    !combinedGr.publisher ||
    !combinedGr.publication_year ||
    !grHtmlMeta?.description ||
    !combinedGr.pages;

  let olMeta = null;
  if (needsOl) {
    olMeta = await fetchOpenLibraryMetadata(
      {
        ...book,
        author: combinedGr.author || book.author,
      },
      { description: !grHtmlMeta?.description }
    );
  }

  const existingFullDesc =
    book.description && !isTruncatedText(book.description) ? book.description : null;
  let bestDescription = existingFullDesc || grHtmlMeta?.description || null;
  if (!bestDescription) {
    const grShort = grAcMeta?.description || book.description || null;
    const olDesc = olMeta?.description || null;
    if (olDesc && (!grShort || (isTruncatedText(grShort) && olDesc.length > grShort.length + 25))) {
      bestDescription = olDesc;
    } else {
      bestDescription = grShort || olDesc;
    }
  }

  let resolvedAuthor = book.author;
  if (combinedGr.author) {
    resolvedAuthor = combinedGr.author;
  } else if (olMeta?.author && (book.author === 'Unknown Author' || isSameAuthorClose(book.author, olMeta.author))) {
    resolvedAuthor = olMeta.author;
  }

  const existingCleanGenres = canonicalizeGenresList(book.genres, book);
  const resolvedGenres =
    (existingCleanGenres.length ? existingCleanGenres : null) ||
    (combinedGr.genres?.length ? combinedGr.genres : null) ||
    (olMeta?.genres?.length ? olMeta.genres : null) ||
    [];

  return {
    author: resolvedAuthor,
    genres: resolvedGenres,
    description: bestDescription,
    isbn: book.isbn || combinedGr.isbn || olMeta?.isbn || null,
    pages: book.pages || combinedGr.pages || olMeta?.pages || null,
    publisher: book.publisher || combinedGr.publisher || olMeta?.publisher || null,
    publication_year:
      book.publication_year || combinedGr.publication_year || olMeta?.publication_year || null,
    language: book.language || combinedGr.language || olMeta?.language || null,
    original_title: book.original_title || combinedGr.original_title || null,
    series: book.series || combinedGr.series || null,
    awards: book.awards?.length ? book.awards : combinedGr.awards || [],
    goodreads_rating: book.goodreads_rating || combinedGr.goodreads_rating || null,
    format:
      book.format ||
      normalizeBookFormat(combinedGr.format, formatMap) ||
      null,
    cover_url: book.cover_url || combinedGr.cover_url || null,
  };
}

export async function enrichBooksMetadata(
  books,
  {
    existingBooks = [],
    formatMap = {},
    forceRefresh = process.env.FORCE_METADATA_REFRESH === 'true',
    concurrency = 2,
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

      const sameGrUrl = !book.goodreads_url || !prev?.goodreads_url || prev.goodreads_url === book.goodreads_url;
      const prevCleanGenres = prev ? canonicalizeGenresList(prev.genres, book) : [];
      const prevHasComplete = prev && hasCompleteEnrichment({ ...prev, genres: prevCleanGenres });

      if (!forceRefresh && prevHasComplete && sameGrUrl) {
        enriched[idx] = {
          ...book,
          author: prev.author || book.author,
          genres: book.genres?.length ? canonicalizeGenresList(book.genres, book) : prevCleanGenres,
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

      const seedBook =
        !forceRefresh && prev && sameGrUrl
          ? {
              ...book,
              author: prev.author || book.author,
              genres: book.genres?.length ? canonicalizeGenresList(book.genres, book) : prevCleanGenres,
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
            }
          : book;

      const fetched = await fetchSingleBookMetadata(seedBook, { formatMap, wafState });
      enriched[idx] = {
        ...book,
        ...fetched,
      };
      fetchedCount += 1;
      if (onProgress) {
        onProgress(fetchedCount + reusedCount, books.length, book.title);
      }
      await sleep(220);
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
  console.log(`Enriching ${existing.books.length} books from Goodreads & Open Library...`);
  const { books: enrichedRaw, fetchedCount, reusedCount } = await enrichBooksMetadata(existing.books, {
    existingBooks: forceRefresh ? [] : existing.books,
    formatMap: config.formatMap || {},
    forceRefresh,
    concurrency: 2,
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
  console.log(`Enrichment complete: fetched=${fetchedCount}, reused=${reusedCount}, total=${books.length}`);
}
