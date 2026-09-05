import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestTypeFor, normalizeData, summarize, selectData, detailRows, dailyRows, percentileRows, simulateModels } from '../src/analytics.js';
import { parsePiSessionJsonl } from '../vendor/vibe-usage/src/parsers/pi-session-jsonl.js';
import { parse as parseClaude } from '../vendor/vibe-usage/src/parsers/claude-code.js';

const prices = { test: { input: 1, output: 1, cacheRead: 1, reasoning: 1 } };
test('request evidence, legacy fallback, exact partition and extrema', () => {
  assert.equal(requestTypeFor({ content: [], stopReason: 'stop' }), 'non_tool');
  assert.equal(requestTypeFor({ content: [{ type: 'text' }], stopReason: 'aborted' }), 'other');
  assert.equal(requestTypeFor({ stopReason: 'stop' }), 'other', 'Missing response must remain unknown');
  assert.equal(requestTypeFor({ content: [{ type: 'text' }, { type: 'toolCall' }, { type: 'toolCall' }] }), 'tool');
  assert.equal(requestTypeFor({ content: [{ type: 'thinking' }], stop_reason: 'tool_use' }), 'tool');
  const raw = { buckets: ['non_tool', 'tool', undefined].map((requestType, i) => ({ source: 'demo', model: 'test', project: 'p', hostname: 'h', bucketStart: `2026-09-0${i + 1}T00:00:00Z`, inputTokens: (i + 1) * 100, requestType })), sessions: [] };
  const data = normalizeData(raw, { timeZone: 'UTC', prices });
  assert.deepEqual(data.buckets.map(row => row.requestType), ['non_tool', 'tool', 'other']);
  const filters = { from: '2026-09-01', to: '2026-09-04' };
  const sums = ['non_tool', 'tool', 'other'].map(requestType => summarize(selectData(data, { ...filters, requestType }).buckets).allTokens);
  assert.equal(sums.reduce((a, b) => a + b), summarize(data.buckets).allTokens);
  assert.equal(detailRows(data.buckets).length, 3);
  const days = dailyRows(data.buckets, filters.from, filters.to);
  const row = percentileRows(days)[0];
  assert.equal(row.min, 100); assert.equal(row.max, 300);
  assert.equal(percentileRows(dailyRows(data.buckets, filters.from, filters.to, true))[0].min, 0);
  const scenario = simulateModels(days, ['test'], prices)[0];
  assert.equal(scenario.min, .0001); assert.equal(scenario.max, .0003);
  assert.equal(simulateModels([], ['test'], prices)[0].min, null);
  assert.equal(simulateModels(days, ['missing'], prices)[0].max, null);
  assert.throws(() => normalizeData({ ...raw, buckets: [{ ...raw.buckets[0], requestType: 'guess' }] }, { timeZone: 'UTC', prices }), /请求类型/);
});

test('Pi and Claude parser fragments classify once without changing token totals, in either order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-usage-types-'));
  const previous = process.env.VIBE_USAGE_CLAUDE_DIRS;
  try {
    for (const harness of ['pi', 'claude']) for (const reverse of [false, true]) {
      const dir = join(root, `${harness}-${reverse}`);
      const sessionDir = harness === 'claude' ? join(dir, 'projects', 'demo') : dir;
      await mkdir(sessionDir, { recursive: true });
      const usage = harness === 'pi' ? { input: 100, output: 20, cacheRead: 200 } : { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 200 };
      const message = (id, content, complete, partial = false) => {
        const m = { role: 'assistant', model: 'test', id, content, usage: { ...usage, ...(partial ? harness === 'pi' ? { output: 10 } : { output_tokens: 10 } : {}) } };
        if (complete) m[harness === 'pi' ? 'stopReason' : 'stop_reason'] = harness === 'pi' ? 'stop' : 'end_turn';
        return { type: harness === 'pi' ? 'message' : 'assistant', id, timestamp: '2026-09-01T00:00:00Z', message: m };
      };
      const rows = [message('r1', [{ type: 'text' }], true), message('r1', [{ type: harness === 'pi' ? 'toolCall' : 'tool_use' }], false, true), message('r2', [{ type: 'text' }], true), message('r3', [], false)];
      await writeFile(join(sessionDir, 'session.jsonl'), (reverse ? rows.reverse() : rows).map(JSON.stringify).join('\n'));
      process.env.VIBE_USAGE_CLAUDE_DIRS = dir;
      const result = harness === 'pi' ? await parsePiSessionJsonl({ source: 'pi-coding-agent', sessionsDirs: [dir] }) : await parseClaude();
      const normalized = normalizeData({ buckets: result.buckets, sessions: [] }, { timeZone: 'UTC', prices });
      assert.deepEqual(normalized.buckets.map(row => row.requestType).sort(), ['non_tool', 'other', 'tool']);
      assert.equal(summarize(normalized.buckets).allTokens, 960);
      assert.equal(normalized.buckets.find(row => row.requestType === 'tool').outputTokens, 20, 'Tool fragment must not replace the fuller usage');
    }
  } finally {
    if (previous === undefined) delete process.env.VIBE_USAGE_CLAUDE_DIRS; else process.env.VIBE_USAGE_CLAUDE_DIRS = previous;
    await rm(root, { recursive: true, force: true });
  }
});
