import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverQuotaProducts } from '../src/quotas/registry.js';
import { quotaFetch } from '../src/quotas/network.js';
import {
  fetchKimiCodeQuota,
  kimiCredentialPath,
  parseKimiUsage,
} from '../src/quotas/providers/kimi-code.js';
import { fetchZaiQuota, parseZaiQuota } from '../src/quotas/providers/zai.js';
import {
  fetchGrokQuota,
  grokBillingLogPath,
  parseGrokBillingLog,
} from '../src/quotas/providers/grok.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const kimiPayload = {
  usage: { name: 'Weekly', used: 25, limit: 100, reset_at: '2026-09-14T00:00:00Z' },
  limits: [{
    window: { duration: 300, timeUnit: 'MINUTE' },
    detail: { remaining: 80, limit: 100, resetAt: '2026-09-07T05:00:00Z' },
  }],
};

const zaiPayload = {
  code: 200,
  success: true,
  data: {
    planName: 'Synthetic Pro',
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25 },
      { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 224, remaining: 776, percentage: 22 },
    ],
  },
};

test('quota discovery emits schema v1 without reading credentials or using network', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-quota-discovery-'));
  try {
    mkdirSync(join(root, '.kimi-code'));
    mkdirSync(join(root, '.grok', 'logs'), { recursive: true });
    mkdirSync(join(root, '.cursor'));
    const envelope = discoverQuotaProducts({ environment: { PATH: '' }, home: root, platform: 'linux' });
    assert.equal(envelope.schemaVersion, 1);
    assert.deepEqual(envelope.products, [
      { id: 'kimi-code', detected: true, fetchable: true },
      { id: 'zcode', detected: false, fetchable: true },
      { id: 'grok', detected: true, fetchable: true },
      { id: 'cursor', detected: true, fetchable: false },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('quota network accepts only exact official endpoints and blocks redirects', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true });
  };
  await quotaFetch('https://api.z.ai/api/monitor/usage/quota/limit', {
    method: 'GET',
  }, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(quotaFetch('https://api.z.ai.evil.test/api/monitor/usage/quota/limit', {
    method: 'GET',
  }, { fetchImpl }), /blocked quota network destination/);
  await assert.rejects(quotaFetch('https://api.z.ai/api/monitor/usage/quota/limit?next=evil', {
    method: 'GET',
  }, { fetchImpl }), /blocked quota network destination/);
  await assert.rejects(quotaFetch('https://api.z.ai/api/monitor/usage/quota/limit', {
    method: 'POST', body: 'usage',
  }, { fetchImpl }), /blocked quota network destination/);
  await assert.rejects(quotaFetch('https://api.z.ai/api/monitor/usage/quota/limit', {}, {
    fetchImpl, offline: true,
  }), { name: 'QuotaOfflineError' });
  assert.equal(calls.length, 1);
});

test('Kimi usage parser and fresh fetch expose only normalized meters', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-kimi-quota-'));
  const share = join(root, 'share');
  const credentialsPath = join(share, 'credentials', 'kimi-code.json');
  mkdirSync(join(share, 'credentials'), { recursive: true });
  writeFileSync(credentialsPath, JSON.stringify({
    access_token: 'synthetic-kimi-token',
    refresh_token: 'must-not-be-used',
    expires_at: 2_000_000_000,
  }));
  try {
    const meters = parseKimiUsage(kimiPayload, new Date('2026-09-07T00:00:00Z'));
    assert.equal(meters.length, 2);
    assert.equal(meters[1].windowSeconds, 18_000);
    assert.equal(kimiCredentialPath({ KIMI_SHARE_DIR: share }, root), credentialsPath);

    let request;
    const result = await fetchKimiCodeQuota({
      environment: { KIMI_SHARE_DIR: share },
      home: root,
      now: new Date('2026-09-07T00:00:00Z'),
      fetchImpl: async (url, options) => {
        request = { url, options };
        return jsonResponse(kimiPayload);
      },
    });
    assert.equal(result.status, 'ok');
    assert.equal(request.url, 'https://api.kimi.com/coding/v1/usages');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.headers.Authorization, 'Bearer synthetic-kimi-token');
    assert.equal(JSON.stringify(result).includes('synthetic-kimi-token'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Kimi refresh is synthetic, atomic, owner-only, and skipped in offline mode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-kimi-refresh-'));
  const credentialDirectory = join(root, '.kimi', 'credentials');
  const credentialPath = join(credentialDirectory, 'kimi-code.json');
  mkdirSync(credentialDirectory, { recursive: true });
  writeFileSync(credentialPath, JSON.stringify({
    access_token: 'synthetic-expired-access',
    refresh_token: 'synthetic-refresh',
    expires_at: 1,
    expires_in: 900,
  }), { mode: 0o600 });
  try {
    const requests = [];
    const result = await fetchKimiCodeQuota({
      home: root,
      now: new Date('2026-09-07T00:00:00Z'),
      sleepImpl: async () => {},
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (url === 'https://auth.kimi.com/api/oauth/token') {
          return jsonResponse({
            access_token: 'synthetic-fresh-access',
            refresh_token: 'synthetic-fresh-refresh',
            expires_in: 900,
          });
        }
        return jsonResponse(kimiPayload);
      },
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(requests.map(request => request.url), [
      'https://auth.kimi.com/api/oauth/token',
      'https://api.kimi.com/coding/v1/usages',
    ]);
    const persisted = JSON.parse(readFileSync(credentialPath, 'utf8'));
    assert.equal(persisted.access_token, 'synthetic-fresh-access');
    assert.equal(persisted.refresh_token, 'synthetic-fresh-refresh');
    if (process.platform !== 'win32') assert.equal(statSync(credentialPath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(result).includes('synthetic-fresh-access'), false);

    let called = false;
    const offlineResult = await fetchKimiCodeQuota({
      home: root,
      now: new Date('2026-09-07T00:00:00Z'),
      offline: true,
      fetchImpl: async () => { called = true; return jsonResponse(kimiPayload); },
    });
    assert.equal(called, false);
    assert.equal(offlineResult.status, 'retryable_error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ZCode requires an explicit regional key and routes it to the matching endpoint', async () => {
  let called = false;
  const missing = await fetchZaiQuota({ fetchImpl: async () => { called = true; } });
  assert.equal(missing.status, 'missing_credentials');
  assert.equal(called, false);

  const requests = [];
  const result = await fetchZaiQuota({
    environment: { BIGMODEL_API_KEY: 'synthetic-bigmodel-key', Z_AI_API_KEY: 'must-not-be-used' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse(zaiPayload);
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.planLabel, 'Synthetic Pro');
  assert.equal(requests[0].url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-bigmodel-key');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(JSON.stringify(result).includes('synthetic-bigmodel-key'), false);
  assert.equal(parseZaiQuota(zaiPayload).meters.length, 2);
});

test('Grok reads only a bounded local billing event and never needs network access', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-usage-grok-quota-'));
  const grokHome = join(root, 'custom-grok');
  const logPath = join(grokHome, 'logs', 'unified.jsonl');
  mkdirSync(join(grokHome, 'logs'), { recursive: true });
  const event = {
    ts: '2026-09-08T02:00:00Z',
    msg: 'billing: fetched credits config',
    ctx: {
      config: {
        creditUsagePercent: 30,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-09-07T00:00:00Z',
          end: '2026-09-14T00:00:00Z',
        },
        accountId: 'must-not-be-returned',
      },
      subscriptionTier: 'Synthetic Premium',
      accessToken: 'must-not-be-returned',
    },
  };
  writeFileSync(logPath, `${JSON.stringify(event)}\n`);
  try {
    assert.equal(grokBillingLogPath({ GROK_HOME: grokHome }, root), logPath);
    const parsed = parseGrokBillingLog(JSON.stringify(event), new Date('2026-09-08T03:00:00Z'));
    assert.equal(parsed.meters[0].utilization, 30);
    assert.equal(JSON.stringify(parsed).includes('must-not-be-returned'), false);
    const result = fetchGrokQuota({
      environment: { GROK_HOME: grokHome },
      home: root,
      now: new Date('2026-09-08T03:00:00Z'),
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.source, 'local');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
