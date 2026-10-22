// Marks dist/cjs as CommonJS so Node resolves the dual build correctly.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), 'dist/cjs');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
