import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sourceFetch } from '../src/network.js';
import { renderReport } from '../src/report.js';

test('network permits only source retrieval, blocks uploads and redirects', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return { ok: true }; });
  delete process.env.PI_USAGE_OFFLINE;
  await sourceFetch('https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens');
  await sourceFetch('http://127.0.0.1:1234/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory', { method: 'POST', body: JSON.stringify({ cascadeId: 'local-id' }) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, 'error');
  for (const [url, opts] of [
    ['https://vibecafe.ai/api/usage/ingest', { method: 'POST', body: 'private' }],
    ['https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens', { method: 'POST' }],
    ['https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens', { body: 'private' }],
    ['https://cursor.com.evil.test/api/dashboard/export-usage-events-csv?strategy=tokens', {}],
    ['http://127.0.0.1:1234/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory', { method: 'POST', body: '{"buckets":[]}' }],
  ]) await assert.rejects(sourceFetch(url, opts));
  process.env.PI_USAGE_OFFLINE = '1';
  try { await assert.rejects(sourceFetch('https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens')); }
  finally { delete process.env.PI_USAGE_OFFLINE; }
  assert.equal(calls.length, 2);
});

test('self-contained HTML escapes hostile data and authorizes only its exact script', async () => {
  const payload = '</script><img src="https://evil.test" onerror="alert(1)">';
  const html = await renderReport({ project: payload });
  assert.ok(!html.includes(payload));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes("connect-src 'none'"));
  assert.equal((html.match(/<script>/g) || []).length, 1);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`));
  assert.ok(!/<(?:script|link|img)[^>]+(?:src|href)="https?:/i.test(html));
});

test('vendored dependency closure excludes all upload and daemon modules; no hidden network paths', async () => {
  const root = new URL('../vendor/vibe-usage/src/', import.meta.url);
  const files = await readdir(root, { recursive: true });
  for (const file of files.filter(f => f.endsWith('.js'))) {
    assert.ok(!/^(api|sync|config|state|daemon|init|reset|summary|index)\.js$/.test(file), file);
    const source = await readFile(new URL(file, root), 'utf8');
    assert.ok(!/\bfetch\s*\(|node:(?:https?|net|tls|dgram)\b|new WebSocket|sendBeacon/.test(source), file);
  }
});
