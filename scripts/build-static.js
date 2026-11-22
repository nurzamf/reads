import fs from 'node:fs';
import path from 'node:path';
import { validateAndSanitiseBooks } from './data-validator.js';
import { readJsonSafe } from './utils.js';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

const libraryPath = path.join(ROOT, 'data/library.json');
const library = readJsonSafe(libraryPath);
if (!library || !Array.isArray(library.books)) {
  console.error('Build failed: data/library.json is missing or invalid.');
  process.exit(1);
}

const { books, warnings } = validateAndSanitiseBooks(library.books);
if (warnings.length > 0) {
  for (const w of warnings) console.warn(`Warning: ${w}`);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
fs.cpSync(path.join(ROOT, 'data'), path.join(DIST, 'data'), { recursive: true });

console.log(`Static build complete in dist/ (${books.length} books verified).`);
