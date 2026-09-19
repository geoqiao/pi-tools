import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchQuotaProducts } from '../src/quotas/registry.js';
import { loadCachedQuota } from '../src/quotas/cache.js';

const now = new Date('2026-09-15T12:00:00Z');
const key = 'synthetic-cache-key';
const payload = {
  code: 200,
  success: true,
  data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25 }] },
};

test('quota cache is isolated, sanitized, and reusable only for the same credential scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-quota-cache-'));
  const environment = { BIGMODEL_API_KEY: key, PI_USAGE_CACHE_DIR: root };
  try {
    const live = await fetchQuotaProducts(['zcode'], {
      environment,
      home: root,
      now,
      fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
    });
    assert.equal(live.products[0].status, 'ok');
    const path = join(root, 'quotas', 'quota-cache.json');
    assert.equal(existsSync(path), true);
    const cacheText = readFileSync(path, 'utf8');
    assert.equal(cacheText.includes(key), false);
    assert.equal(cacheText.includes('scope'), true);

    const cached = await fetchQuotaProducts(['zcode'], {
      environment,
      home: root,
      now: new Date(now.getTime() + 60_000),
      offline: true,
      fetchImpl: async () => { throw new Error('network must not be called'); },
    });
    assert.equal(cached.products[0].status, 'ok');
    assert.equal(cached.products[0].source, 'cache');
    assert.equal(JSON.stringify(cached).includes(key), false);

    const different = await fetchQuotaProducts(['zcode'], {
      environment: { ...environment, BIGMODEL_API_KEY: 'synthetic-other-key' },
      home: root,
      now: new Date(now.getTime() + 60_000),
      offline: true,
      fetchImpl: async () => { throw new Error('network must not be called'); },
    });
    assert.equal(different.products[0].status, 'retryable_error');
    assert.equal(different.products[0].source, 'live');

    const loaded = loadCachedQuota('zcode', live.products[0].cacheScope, environment, now);
    assert.equal(loaded?.source, 'cache');
    assert.equal(Object.keys(live.products[0]).includes('cacheScope'), false,
      'cache scope is intentionally non-enumerable and not part of the public result');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('expired quota windows do not resurrect cached data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-quota-cache-expiry-'));
  const environment = { BIGMODEL_API_KEY: key, PI_USAGE_CACHE_DIR: root };
  try {
    await fetchQuotaProducts(['zcode'], {
      environment,
      home: root,
      now,
      fetchImpl: async () => new Response(JSON.stringify({
        ...payload,
        data: { limits: [{ type: 'TOKENS_LIMIT', unit: 5, number: 1, percentage: 25 }] },
      })),
    });
    const expired = await fetchQuotaProducts(['zcode'], {
      environment,
      home: root,
      now: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      offline: true,
      fetchImpl: async () => { throw new Error('network must not be called'); },
    });
    assert.equal(expired.products[0].status, 'retryable_error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
