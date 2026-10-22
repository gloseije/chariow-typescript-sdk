// Usage: node scripts/set-scope.mjs <new-scope>
// Renames the npm scope of both packages (package.json, sources, tests, README).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const corePkg = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
const currentScope = corePkg.name.split('/')[0];
const input = process.argv[2];

if (!input) {
  console.error('Usage: node scripts/set-scope.mjs <new-scope>');
  process.exit(1);
}

const nextScope = input.startsWith('@') ? input : `@${input}`;
if (!/^@[a-z0-9][a-z0-9._-]*$/.test(nextScope)) {
  console.error(`Invalid npm scope: ${nextScope}`);
  process.exit(1);
}

const skip = new Set(['node_modules', 'dist', '.git', 'coverage']);
const exts = ['.json', '.ts', '.md', '.mjs'];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry) || entry === 'package-lock.json') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (exts.some((ext) => path.endsWith(ext))) {
      const content = readFileSync(path, 'utf8');
      const updated = content.split(`${currentScope}/`).join(`${nextScope}/`);
      if (updated !== content) {
        writeFileSync(path, updated);
        console.log(`updated ${path.slice(root.length + 1)}`);
      }
    }
  }
}

walk(root);
console.log(`Scope changed from ${currentScope} to ${nextScope}. Run "npm install" to refresh the lockfile.`);
