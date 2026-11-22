import { loadMappingConfig, resolveSchemaMapping } from './notion-mapper.js';
import {
  extractNotionDatabaseId,
  fetchNotionApi,
  loadLocalEnv,
  normalizeNotionToken,
} from './utils.js';

async function inspectNotionDatabase() {
  loadLocalEnv();
  const token = normalizeNotionToken(process.env.NOTION_TOKEN);
  const databaseId = extractNotionDatabaseId(process.env.NOTION_DATABASE_ID);

  if (!token || !databaseId) {
    console.error('Missing NOTION_TOKEN or NOTION_DATABASE_ID environment variables.');
    console.error('Set them in .env locally or in GitHub Repository Secrets, then re-run: npm run inspect-notion');
    process.exit(1);
  }

  const config = loadMappingConfig();
  const db = await fetchNotionApi(
    `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`,
    { method: 'GET' },
    { token, notionVersion: config.notionVersion }
  );

  const dbTitle = (db.title || []).map((t) => t.plain_text).join('') || 'Untitled Database';
  const properties = db.properties || {};
  const resolution = resolveSchemaMapping(properties, config);

  console.log(`\nInspected Notion Database: "${dbTitle}" (${Object.keys(properties).length} properties)\n`);

  console.log('=== All Notion Properties ===');
  for (const [name, prop] of Object.entries(properties)) {
    let extra = '';
    if (prop.type === 'select' && prop.select?.options) {
      extra = ` [options: ${prop.select.options.map((o) => o.name).join(', ')}]`;
    } else if (prop.type === 'status' && prop.status?.options) {
      extra = ` [options: ${prop.status.options.map((o) => o.name).join(', ')}]`;
    } else if (prop.type === 'multi_select' && prop.multi_select?.options) {
      extra = ` [options: ${prop.multi_select.options.map((o) => o.name).join(', ')}]`;
    }
    console.log(`- ${name} (${prop.type})${extra}`);
  }

  console.log('\n=== Mapped Internal Fields ===');
  for (const [internal, notionName] of Object.entries(resolution.mapping)) {
    console.log(`  ${internal}  <--  "${notionName}"`);
  }

  if (resolution.privateSkipped.length > 0) {
    console.log('\n=== Private / Excluded Properties (never published) ===');
    for (const item of resolution.privateSkipped) {
      console.log(`  [excluded] ${item.name} (${item.type})`);
    }
  }

  if (resolution.unmapped.length > 0) {
    console.log('\n=== Unmapped Public-Candidate Properties ===');
    console.log('Update scripts/notion-mapping.config.json if you want to map any of these:');
    for (const item of resolution.unmapped) {
      console.log(`  - ${item.name} (${item.type})`);
    }
  }

  if (resolution.missingRecommended.length > 0) {
    console.log('\n=== Internal Fields Not Found in Database ===');
    console.log('These optional fields were not matched (they will default to null/empty cleanly):');
    console.log(`  ${resolution.missingRecommended.join(', ')}`);
  }

  console.log('\nSchema inspection complete (read-only; Notion database was not modified).\n');
}

inspectNotionDatabase().catch((error) => {
  console.error('Notion schema inspection failed:', error.message);
  process.exit(1);
});
