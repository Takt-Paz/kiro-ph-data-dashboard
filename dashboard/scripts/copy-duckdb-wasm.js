/**
 * Copies DuckDB-WASM binaries from node_modules to public/ folder.
 * Runs automatically after `npm install` via postinstall hook.
 */
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const dest = join(root, 'public');

const files = [
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
];

if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

for (const file of files) {
  const srcPath = join(src, file);
  const destPath = join(dest, file);
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    console.log(`  ✓ ${file}`);
  } else {
    console.warn(`  ⚠ ${file} not found in node_modules`);
  }
}

console.log('DuckDB-WASM files copied to public/');
