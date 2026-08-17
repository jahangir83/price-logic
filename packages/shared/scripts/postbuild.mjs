import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node decides whether a `.js` file is ESM or CommonJS from the nearest
 * package.json `type` field. This package's root is `commonjs`, so the ESM
 * build under dist/esm would be misread as CommonJS and fail on its first
 * `import` statement. Dropping a scoped marker in each output directory is
 * the standard fix — it keeps the two builds unambiguous without renaming
 * every file to .mjs/.cjs.
 */
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const [dir, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  writeFileSync(
    join(dist, dir, 'package.json'),
    `${JSON.stringify({ type }, null, 2)}\n`,
  );
}
