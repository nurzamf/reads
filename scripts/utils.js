import fs from 'node:fs';
import path from 'node:path';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeMultilineText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function slugify(value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  return (
    cleaned
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'book'
  );
}

export function extractNotionDatabaseId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/^["']|["']$/g, '').trim();
  const cleanUrl = trimmed.split('?')[0];
  const hexMatch = cleanUrl.match(/([a-f0-9]{32})/i);
  if (hexMatch) return hexMatch[1];
  const uuidMatch = cleanUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (uuidMatch) return uuidMatch[1].replace(/-/g, '');
  return trimmed;
}

export function normalizeNotionToken(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

export function loadLocalEnv(rootDir = process.cwd()) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

export function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

export async function fetchNotionApi(url, options = {}, { token, notionVersion = '2022-06-28', maxRetries = 4 } = {}) {
  if (!token) {
    throw new Error('Missing NOTION_TOKEN.');
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': notionVersion,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });

      if (response.ok) {
        return await response.json();
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      const errorText = await response.text().catch(() => '');

      if (!shouldRetry || attempt > maxRetries) {
        throw new Error(`Notion API request failed (HTTP ${response.status}): ${errorText.slice(0, 240)}`);
      }

      const retryAfterSec = Number.parseFloat(response.headers.get('retry-after') || '0');
      const backoffMs = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.min(15000, 800 * 2 ** (attempt - 1));
      console.warn(`Notion API returned HTTP ${response.status}; retrying in ${Math.round(backoffMs)}ms (attempt ${attempt}/${maxRetries})...`);
      await sleep(backoffMs);
    } catch (error) {
      if (attempt > maxRetries) {
        throw error;
      }
      const backoffMs = Math.min(15000, 800 * 2 ** (attempt - 1));
      console.warn(`Transient network error contacting Notion (${error.message}); retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }
}
