import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
// Plain JavaScript package: workspace typecheck hook runs syntax checks, not TypeScript inference.
for (const file of await readdir(root, { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL(file, root))], { stdio: 'pipe' });
}
const original = JSON.parse(await readFile(new URL('vendor/vibe-usage/upstream-files.json', root), 'utf8'));
const patched = new Set(['src/parsers/cursor.js', 'src/parsers/antigravity.js', 'src/parsers/codex-cache.js', 'src/parsers/codex.js', 'src/parsers/zcode.js', 'src/parsers/kimi-code.js', 'src/parsers/aggregate.js', 'src/parsers/pi-session-jsonl.js', 'src/parsers/claude-code.js', 'src/parsers/contract.js']);
for (const [file, hash] of Object.entries(original)) {
  if (patched.has(file)) continue;
  const bytes = await readFile(new URL(`vendor/vibe-usage/${file}`, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `Unrecorded vendor change: ${file}`);
}
console.log('JavaScript syntax and unchanged upstream source hashes verified.');
