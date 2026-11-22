import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { syncNotion } from './sync-notion.js';
import { loadLocalEnv, normalizeNotionToken, extractNotionDatabaseId } from './utils.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const ROOT = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function hasRealNotionCredentials() {
  loadLocalEnv(ROOT);
  const token = normalizeNotionToken(process.env.NOTION_TOKEN || '');
  const dbId = extractNotionDatabaseId(process.env.NOTION_DATABASE_ID || '');
  const notionEnvKeys = Object.keys(process.env).filter((k) =>
    k.toUpperCase().includes('NOTION')
  );
  const tokenShape = token.startsWith('ntn_')
    ? 'ntn_'
    : token.startsWith('secret_')
      ? 'secret_'
      : token
        ? 'other'
        : 'empty';
  const present =
    Boolean(token && dbId) &&
    !token.includes('your_notion_integration_token') &&
    !dbId.includes('your_notion_database_id');
  return { present, notionEnvKeys, tokenShape, tokenLen: token.length, dbIdLen: dbId.length };
}

const credCheck = hasRealNotionCredentials();
const statusLogPath = '/tmp/notion-sync-status.txt';
fs.writeFileSync(
  statusLogPath,
  `checkedAt=${new Date().toISOString()} notionKeys=${credCheck.notionEnvKeys.join(',') || 'none'} tokenShape=${credCheck.tokenShape} tokenLen=${credCheck.tokenLen} dbIdLen=${credCheck.dbIdLen}\n`
);

if (credCheck.present) {
  syncNotion()
    .then((res) => {
      fs.appendFileSync(
        statusLogPath,
        `syncSuccess count=${res.count} updated=${res.updated} reviewsFound=${res.reviewsFound ?? 0}\nschema=${JSON.stringify(res.schemaSummary)}\nresolution=${JSON.stringify(res.resolution)}\n`
      );
    })
    .catch((err) => {
      const msg = `Startup Notion sync skipped/failed (serving existing data/library.json): ${err.message}`;
      console.warn(msg);
      fs.appendFileSync(statusLogPath, `syncError=${err.message}\n`);
    });
}

const server = http.createServer((req, res) => {
  const reqUrl = (req.url || '/').split('?')[0];
  let safePath = path.normalize(decodeURIComponent(reqUrl)).replace(/^(\.\.[/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  let filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': ext === '.json' ? 'no-store' : 'no-cache',
  };

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nurzam’s Library static preview server listening on http://0.0.0.0:${PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
