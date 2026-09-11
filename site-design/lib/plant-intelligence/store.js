import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'plant-intelligence');
export const CANONICAL_PATH = path.join(DATA_DIR, 'canonical.json');

let cache = null;

export function loadCanonical() {
  if (cache) return cache;
  if (!fs.existsSync(CANONICAL_PATH)) {
    cache = { plants: [], meta: { empty: true } };
    return cache;
  }
  cache = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf8'));
  return cache;
}

export function saveCanonical(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CANONICAL_PATH, JSON.stringify(db));
  cache = db;
  return CANONICAL_PATH;
}

export function clearCanonicalCache() {
  cache = null;
}
