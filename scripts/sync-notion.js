import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndSanitiseBooks } from './data-validator.js';
import {
  loadMappingConfig,
  mapNotionPageToBook,
  resolveSchemaMapping,
} from './notion-mapper.js';
import {
  extractNotionDatabaseId,
  fetchNotionApi,
  loadLocalEnv,
  normalizeNotionToken,
  readJsonSafe,
  writeJsonAtomic,
} from './utils.js';

const OUTPUT_PATH = path.resolve(process.cwd(), 'data/library.json');

async function fetchAllDatabasePages(databaseId, token, notionVersion) {
  const pages = [];
  let startCursor = undefined;
  let pageBatch = 0;

  do {
    pageBatch += 1;
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const data = await fetchNotionApi(
      `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      { token, notionVersion }
    );

    if (!Array.isArray(data.results)) {
      throw new Error('Unexpected Notion query response: missing results array.');
    }

    pages.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : undefined;
    console.log(`Fetched batch ${pageBatch}: ${data.results.length} records (total so far: ${pages.length})`);
  } while (startCursor);

  return pages;
}

export async function syncNotion() {
  loadLocalEnv();
  const token = normalizeNotionToken(process.env.NOTION_TOKEN);
  const databaseId = extractNotionDatabaseId(process.env.NOTION_DATABASE_ID);

  if (!token || !databaseId) {
    throw new Error('NOTION_TOKEN and NOTION_DATABASE_ID must be configured.');
  }

  const config = loadMappingConfig();
  const existingData = readJsonSafe(OUTPUT_PATH);

  console.log('1/4 Inspecting Notion database schema...');
  const database = await fetchNotionApi(
    `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`,
    { method: 'GET' },
    { token, notionVersion: config.notionVersion }
  );

  const resolution = resolveSchemaMapping(database.properties || {}, config);
  console.log(`Mapped ${Object.keys(resolution.mapping).length} fields.`);
  if (resolution.unmapped.length > 0) {
    console.log(
      `Unmapped Notion properties (${resolution.unmapped.length}): ${resolution.unmapped
        .map((u) => `${u.name} (${u.type})`)
        .join(', ')}`
    );
  }

  console.log('2/4 Retrieving records from Notion with pagination...');
  const pages = await fetchAllDatabasePages(databaseId, token, config.notionVersion);

  console.log('3/4 Transforming and sanitising public book records...');
  const mappedBooks = pages.map((page) => mapNotionPageToBook(page, resolution.mapping, config));
  const { books, warnings } = validateAndSanitiseBooks(mappedBooks, config);

  for (const warning of warnings) {
    console.warn(`Validation warning: ${warning}`);
  }

  // Guard against accidental wipe of live library if API returns empty unexpectedly
  if (
    books.length === 0 &&
    existingData &&
    !existingData.is_sample_data &&
    Array.isArray(existingData.books) &&
    existingData.books.length > 0 &&
    process.env.ALLOW_EMPTY_SYNC !== 'true'
  ) {
    throw new Error(
      'Safety guard triggered: Notion returned 0 valid books while existing live library has records. Preserving existing data/library.json.'
    );
  }

  // Sort deterministically so unchanged data produces identical JSON
  books.sort((a, b) => a.slug.localeCompare(b.slug));

  const existingBooksJson = existingData ? JSON.stringify(existingData.books || []) : '';
  const nextBooksJson = JSON.stringify(books);
  const wasSampleData = Boolean(existingData?.is_sample_data);

  const schemaSummary = {};
  for (const [name, prop] of Object.entries(database.properties || {})) {
    schemaSummary[name] = {
      type: prop.type,
      options:
        prop.select?.options?.map((o) => o.name) ||
        prop.status?.options?.map((o) => o.name) ||
        prop.multi_select?.options?.map((o) => o.name) ||
        undefined,
    };
  }

  if (!wasSampleData && existingBooksJson === nextBooksJson) {
    console.log('4/4 No changes detected in library data. Skipping write to avoid unnecessary commits.');
    return { updated: false, count: books.length, schemaSummary, resolution };
  }

  const nextPayload = {
    last_updated: new Date().toISOString(),
    data_source: 'notion',
    is_sample_data: false,
    total_books: books.length,
    books,
  };

  writeJsonAtomic(OUTPUT_PATH, nextPayload);
  console.log(`4/4 Successfully published ${books.length} books to data/library.json.`);
  return { updated: true, count: books.length, schemaSummary, resolution };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  syncNotion().catch((error) => {
    console.error('Notion sync failed; existing data/library.json preserved.', error.message);
    process.exit(1);
  });
}
