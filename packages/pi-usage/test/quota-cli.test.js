import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../src/collect.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(testDir, '..');
const bin = join(packageDir, 'bin', 'pi-usage.js');

function run(args, environment = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: packageDir,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('top-level help lists quota commands and follows the parser registry count', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /quota discover --json/);
  assert.match(result.stdout, /quota fetch --product <id> --json/);
  assert.match(result.stdout, new RegExp(`默认全部 ${SOURCES.length} 类`));
});

test('quota CLI emits schema-versioned JSON and does not expose a synthetic key', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-quota-cli-'));
  try {
    const discovery = run(['quota', 'discover', '--json'], {
      HOME: root,
      PATH: '',
      PI_USAGE_CACHE_DIR: join(root, 'cache'),
    });
    assert.equal(discovery.status, 0, discovery.stderr);
    assert.equal(JSON.parse(discovery.stdout).schemaVersion, 1);

    const fetch = run(['quota', 'fetch', '--product', 'zcode', '--json', '--offline'], {
      HOME: root,
      PATH: '',
      BIGMODEL_API_KEY: 'synthetic-cli-key',
      Z_AI_API_KEY: '',
      PI_USAGE_CACHE_DIR: join(root, 'cache'),
    });
    assert.equal(fetch.status, 0, fetch.stderr);
    const payload = JSON.parse(fetch.stdout);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.products[0].id, 'zcode');
    assert.equal(fetch.stdout.includes('synthetic-cli-key'), false);
    assert.equal(fetch.stderr, '');

    const unsupported = run(['quota', 'fetch', '--product', 'cursor', '--json'], {
      HOME: root,
      PATH: '',
      PI_USAGE_CACHE_DIR: join(root, 'cache'),
    });
    assert.equal(unsupported.status, 1);
    assert.equal(unsupported.stdout, '');
    assert.match(unsupported.stderr, /Unsupported quota product: cursor/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI --version is side-effect free and price overrides preserve legacy and TTL write rates', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-cli-prices-'));
  const input = join(root, 'input.json');
  const prices = join(root, 'prices.json');
  const output = join(root, 'report');
  try {
    const expectedVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
    const version = run(['--version'], { HOME: root });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout, `${expectedVersion}\n`);
    writeFileSync(input, JSON.stringify({ buckets: [], sessions: [], execution: [] }));
    writeFileSync(prices, JSON.stringify({ models: {
      synthetic: {
        input: 1, cacheRead: 2, cacheWrite: 3, cacheWrite5m: 4,
        cacheWrite1h: 5, output: 6, reasoning: 7,
      },
    } }));
    const report = run([
      '--input', input, '--prices', prices, '--out', output,
      '--days', '1', '--timezone', 'UTC', '--offline',
    ], { HOME: root, PI_USAGE_CACHE_DIR: join(root, 'cache') });
    assert.equal(report.status, 0, report.stderr);
    const exported = JSON.parse(readFileSync(join(output, 'usage.json'), 'utf8'));
    assert.deepEqual(exported.priceSnapshot.supplementalPricing, {
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      verifiedDate: '2026-09-19',
      note: 'Official Anthropic 5m/1h cache-write multipliers and the two supported fast-mode aliases are supplemental to the models.dev snapshot.',
    });
    assert.deepEqual(exported.prices.synthetic, {
      input: 1,
      output: 6,
      cacheRead: 2,
      reasoning: 7,
      cacheWrite: 3,
      cacheWrite5m: 4,
      cacheWrite1h: 5,
      provider: 'local-override',
      reference: '用户本地价格表',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
