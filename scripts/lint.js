import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateAndSanitiseBooks } from './data-validator.js';
import { readJsonSafe } from './utils.js';

const ROOT = process.cwd();

function collectJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

const jsFiles = [
  ...collectJsFiles(path.join(ROOT, 'assets/js')),
  ...collectJsFiles(path.join(ROOT, 'scripts')),
];

for (const file of jsFiles) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

const library = readJsonSafe(path.join(ROOT, 'data/library.json'));
if (!library || !Array.isArray(library.books)) {
  console.error('Lint failed: data/library.json is invalid JSON.');
  process.exit(1);
}

const mappingConfig = readJsonSafe(path.join(ROOT, 'scripts/notion-mapping.config.json'));
if (!mappingConfig || !mappingConfig.properties) {
  console.error('Lint failed: scripts/notion-mapping.config.json is invalid.');
  process.exit(1);
}

const { warnings } = validateAndSanitiseBooks(library.books, mappingConfig);
if (warnings.length > 0) {
  console.error('Lint failed with data validation warnings:', warnings);
  process.exit(1);
}

// Verify local cover asset references exist
for (const book of library.books) {
  if (typeof book.cover_url === 'string' && book.cover_url.startsWith('./')) {
    const resolved = path.join(ROOT, book.cover_url.slice(2));
    if (!fs.existsSync(resolved)) {
      console.error(`Lint failed: missing local cover asset ${book.cover_url}`);
      process.exit(1);
    }
  }
}

console.log(`Lint passed: ${jsFiles.length} JavaScript modules, data/library.json, and static assets verified.`);
