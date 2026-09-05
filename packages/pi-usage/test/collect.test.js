import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../src/collect.js';
import { parsers } from '../vendor/vibe-usage/src/parsers/index.js';

test('collector isolates source failures and flags unfinished indexes without leaking diagnostics', async t => {
  t.mock.method(parsers, 'codex', async () => ({ buckets: [], sessions: [], skipped: true, indexing: { completedFiles: 1 } }));
  t.mock.method(parsers, 'cursor', async () => { throw new Error('secret-auth-token'); });
  t.mock.method(parsers, 'pi-coding-agent', async () => ({ buckets: [{ source: 'pi-coding-agent', model: 'test', bucketStart: '2026-09-01T00:00:00Z', inputTokens: 100, message: 'private-prompt' }], sessions: [] }));
  const result = await collect({ sources: ['codex', 'cursor', 'pi-coding-agent'], timeZone: 'UTC', prices: {} });
  assert.deepEqual(result.statuses.map(s => s.state), ['partial', 'error', 'ok']);
  assert.equal(result.buckets.length, 1);
  assert.ok(result.statuses[0].note.includes('索引尚未完成'));
  assert.ok(!JSON.stringify(result).includes('secret-auth-token'));
  assert.ok(!JSON.stringify(result).includes('private-prompt'));
  await assert.rejects(collect({ sources: ['nonexistent'], timeZone: 'UTC', prices: {} }), /未知数据源/);
});
