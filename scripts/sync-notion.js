import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndSanitiseBooks } from './data-validator.js';
import { enrichBooksMetadata } from './goodreads-enricher.js';
import {
  isPrivatePropertyName,
  loadMappingConfig,
  mapNotionPageToBook,
  resolveSchemaMapping,
} from './notion-mapper.js';
import {
  extractNotionDatabaseId,
  fetchNotionApi,
  loadLocalEnv,
  normalizeMultilineText,
  normalizeNotionToken,
  readJsonSafe,
  sleep,
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

function richTextToPlain(richTextArr) {
  if (!Array.isArray(richTextArr)) return '';
  return richTextArr.map((item) => item?.plain_text || '').join('');
}

async function fetchBlockChildren(blockId, token, notionVersion) {
  const blocks = [];
  let startCursor = undefined;

  do {
    const qs = new URLSearchParams({ page_size: '100' });
    if (startCursor) qs.set('start_cursor', startCursor);

    const data = await fetchNotionApi(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`,
      { method: 'GET' },
      { token, notionVersion }
    );

    if (Array.isArray(data.results)) {
      blocks.push(...data.results);
    }
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return blocks;
}

async function extractBlocksText(blocks, token, notionVersion, privatePatterns = [], depth = 0) {
  const sections = [];
  let skipPrivateSection = false;
  let listCounter = 0;

  for (const block of blocks) {
    if (!block || !block.type || block.archived || block.in_trash) continue;
    const type = block.type;
    const payload = block[type];

    const isHeading = type === 'heading_1' || type === 'heading_2' || type === 'heading_3';
    if (isHeading) {
      const headingText = richTextToPlain(payload?.rich_text).trim();
      if (isPrivatePropertyName(headingText, privatePatterns)) {
        skipPrivateSection = true;
        continue;
      }
      skipPrivateSection = false;
      listCounter = 0;
      if (headingText) {
        sections.push({ kind: 'para', text: headingText });
      }
      if (block.has_children && depth < 5) {
        const children = await fetchBlockChildren(block.id, token, notionVersion);
        const childText = await extractBlocksText(
          children,
          token,
          notionVersion,
          privatePatterns,
          depth + 1
        );
        if (childText) {
          sections.push({ kind: 'para', text: childText });
        }
      }
      continue;
    }

    if (skipPrivateSection) continue;

    if (type !== 'numbered_list_item') {
      listCounter = 0;
    }

    let lineText = '';
    let kind = 'para';

    switch (type) {
      case 'paragraph':
      case 'quote':
      case 'callout':
      case 'toggle':
        lineText = richTextToPlain(payload?.rich_text).trim();
        break;
      case 'bulleted_list_item':
        lineText = richTextToPlain(payload?.rich_text).trim();
        if (lineText) lineText = `• ${lineText}`;
        kind = 'list';
        break;
      case 'numbered_list_item':
        listCounter += 1;
        lineText = richTextToPlain(payload?.rich_text).trim();
        if (lineText) lineText = `${listCounter}. ${lineText}`;
        kind = 'list';
        break;
      case 'to_do':
        lineText = richTextToPlain(payload?.rich_text).trim();
        if (lineText) lineText = `${payload?.checked ? '[x]' : '[ ]'} ${lineText}`;
        kind = 'list';
        break;
      case 'code':
        lineText = richTextToPlain(payload?.rich_text).trim();
        break;
      case 'table_row':
        if (Array.isArray(payload?.cells)) {
          lineText = payload.cells
            .map((cell) => richTextToPlain(cell).trim())
            .filter(Boolean)
            .join(' · ');
        }
        break;
      default:
        break;
    }

    if (lineText) {
      sections.push({ kind, text: lineText });
    }

    const syncedSourceId = type === 'synced_block' ? payload?.synced_from?.block_id : null;
    const childContainerId = block.has_children ? block.id : syncedSourceId;
    const canRecurse =
      Boolean(childContainerId) &&
      depth < 5 &&
      type !== 'child_page' &&
      type !== 'child_database';

    if (canRecurse) {
      const children = await fetchBlockChildren(childContainerId, token, notionVersion);
      const childText = await extractBlocksText(
        children,
        token,
        notionVersion,
        privatePatterns,
        depth + 1
      );
      if (childText) {
        sections.push({ kind: 'para', text: childText });
      }
    }
  }

  let output = '';
  for (let i = 0; i < sections.length; i += 1) {
    const curr = sections[i];
    const prev = sections[i - 1];
    if (i === 0) {
      output += curr.text;
    } else if (curr.kind === 'list' && prev?.kind === 'list') {
      output += `\n${curr.text}`;
    } else {
      output += `\n\n${curr.text}`;
    }
  }

  return normalizeMultilineText(output) || null;
}

async function fetchAllPageBodyReviews(pages, existingBooks, token, notionVersion, config) {
  const existingByPageId = new Map();
  for (const prev of existingBooks || []) {
    if (prev.notion_page_id) existingByPageId.set(prev.notion_page_id, prev);
  }

  const reviewsByPageId = new Map();
  let cursor = 0;
  let reviewsFound = 0;
  const concurrency = 3;

  async function worker() {
    while (cursor < pages.length) {
      const page = pages[cursor];
      cursor += 1;
      try {
        const blocks = await fetchBlockChildren(page.id, token, notionVersion);
        const bodyReview = await extractBlocksText(
          blocks,
          token,
          notionVersion,
          config.privateFieldPatterns || []
        );
        if (bodyReview) {
          reviewsByPageId.set(page.id, bodyReview);
          reviewsFound += 1;
        }
      } catch (err) {
        console.warn(`Failed fetching page body for ${page.id}: ${err.message}`);
        const fallback = existingByPageId.get(page.id)?.review || null;
        if (fallback) {
          reviewsByPageId.set(page.id, fallback);
        }
      }
      await sleep(120);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { reviewsByPageId, reviewsFound };
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

  console.log('1/5 Inspecting Notion database schema...');
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

  console.log('2/5 Retrieving records from Notion with pagination...');
  const pages = await fetchAllDatabasePages(databaseId, token, config.notionVersion);

  console.log('3/5 Fetching Notion page body reviews...');
  const { reviewsByPageId, reviewsFound } = await fetchAllPageBodyReviews(
    pages,
    existingData?.books || [],
    token,
    config.notionVersion,
    config
  );
  console.log(`Extracted page body reviews from ${reviewsFound} Notion entries.`);

  console.log('4/5 Mapping records and enriching book metadata from Goodreads & Open Library...');
  const mappedBooks = pages.map((page) => {
    const mapped = mapNotionPageToBook(page, resolution.mapping, config);
    const bodyReview = reviewsByPageId.get(page.id);
    if (bodyReview) {
      mapped.review = mapped.review ? `${mapped.review}\n\n${bodyReview}` : bodyReview;
    }
    return mapped;
  });

  const { books: enrichedBooks, fetchedCount, reusedCount } = await enrichBooksMetadata(mappedBooks, {
    existingBooks: existingData?.books || [],
    formatMap: config.formatMap || {},
  });
  console.log(`Book metadata enrichment complete (fetched=${fetchedCount}, reused=${reusedCount}).`);

  const { books, warnings } = validateAndSanitiseBooks(enrichedBooks, config);

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
    console.log('5/5 No changes detected in library data. Skipping write to avoid unnecessary commits.');
    return { updated: false, count: books.length, reviewsFound, schemaSummary, resolution };
  }

  const nextPayload = {
    last_updated: new Date().toISOString(),
    data_source: 'notion',
    is_sample_data: false,
    total_books: books.length,
    books,
  };

  writeJsonAtomic(OUTPUT_PATH, nextPayload);
  console.log(`5/5 Successfully published ${books.length} books to data/library.json.`);
  return { updated: true, count: books.length, reviewsFound, schemaSummary, resolution };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  syncNotion().catch((error) => {
    console.error('Notion sync failed; existing data/library.json preserved.', error.message);
    process.exit(1);
  });
}
