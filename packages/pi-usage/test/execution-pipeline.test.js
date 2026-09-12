import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePiSessionJsonl } from '../vendor/vibe-usage/src/parsers/pi-session-jsonl.js';
import { normalizeParserResult } from '../vendor/vibe-usage/src/parsers/contract.js';
import { parsers } from '../vendor/vibe-usage/src/parsers/index.js';
import { collect } from '../src/collect.js';
import { normalizeData, summarize } from '../src/analytics.js';
import { summarizeExecution, selectExecution } from '../src/execution.js';

const cli = fileURLToPath(new URL('../bin/pi-usage.js', import.meta.url));
const source = 'pi-coding-agent';
function fixture(timestamp) {
  return [
    { type: 'session', id: 'PRIVATE_SESSION', cwd: '/PRIVATE_PATH/synthetic-project' },
    { id: 'PRIVATE_ENTRY', type: 'message', timestamp, message: {
      role: 'assistant', model: 'synthetic-model', provider: 'synthetic-provider',
      responseId: 'PRIVATE_RESPONSE', stopReason: 'toolUse',
      usage: { input: 12, cacheRead: 30, cacheWrite: 4, output: 8, reasoning: 3 },
      content: [{ type: 'text', text: 'PRIVATE_PROMPT' },
        { type: 'toolCall', id: 'PRIVATE_TOOL', name: 'exec', arguments: { code: 'PRIVATE_CODE' } }],
    } },
    { type: 'message', timestamp, message: { role: 'toolResult', toolCallId: 'PRIVATE_TOOL',
      content: [{ type: 'text', text: 'PRIVATE_RESULT' }], details: {
        codeMode: true, cellId: 'PRIVATE_CELL', status: 'result',
        traces: [0, 1, 2].map(i => ({ id: 'PRIVATE_TRACE_' + i, name: 'exec_command', status: 'done',
          input: { cmd: 'PRIVATE_COMMAND' }, result: { content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }], details: { exit_code: 0 } } })),
      } } },
  ];
}

test('native parser -> contract -> collection -> CLI round trip retains execution but no tool payloads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-usage-execution-'));
  try {
    const timestamp = new Date().toISOString();
    await writeFile(join(root, 'fixture.jsonl'), fixture(timestamp).map(JSON.stringify).join('\n'));
    const raw = await parsePiSessionJsonl({ source, sessionsDirs: [root] });
    const normalized = normalizeParserResult(source, raw);
    assert.equal(normalized.execution.length, 1);
    assert.throws(() => normalizeParserResult(source, { buckets: [], execution: [{ source: 'wrong' }] }), /execution/);
    assert.throws(() => normalizeParserResult(source, { buckets: [], execution: {} }), /execution/);
    t.mock.method(parsers, source, async () => raw);
    const data = await collect({ sources: [source], timeZone: 'UTC', prices: {} });
    assert.equal(data.statuses[0].state, 'ok');
    assert.equal(data.execution[0].fullInputTokens, 46);
    assert.equal(data.execution[0].outputTokens, 8);
    assert.equal(data.execution[0].sessionHash, data.sessions[0].sessionHash, 'Native session hash agrees with sessions.csv without a guessed join');
    assert.equal(summarizeExecution(data.execution).meanTools, 3);
    assert.equal(summarize(data.buckets).allTokens, 54, 'Legacy token accounting remains unchanged');
    assert.equal(data.buckets[0].inputTokens, 16);
    assert.equal(data.buckets[0].outputTokens, 5);
    assert.equal(data.buckets[0].reasoningOutputTokens, 3);
    assert.ok(!JSON.stringify(data).includes('PRIVATE_'));
    const [row] = data.execution;
    const filters = { from: row.date, to: row.date };
    for (const key of ['source', 'model', 'project', 'hostname', 'requestType']) {
      assert.equal(selectExecution(data, { ...filters, [key]: row[key] }).length, 1, key);
      assert.equal(selectExecution(data, { ...filters, [key]: 'absent' }).length, 0, key);
    }
    const input = join(root, 'input.json'), out = join(root, 'out');
    // Unknown import fields and out-of-window rows must not survive serialization.
    await writeFile(input, JSON.stringify({ ...data, execution: [
      { ...row, code: 'PRIVATE_CODE', trace: fixture(timestamp) },
      { ...row, timestamp: '2000-01-01T00:00:00Z', responseHash: 'f'.repeat(24) },
    ] }));
    execFileSync(process.execPath, [cli, '--input', input, '--out', out, '--offline', '--days', '2', '--timezone', 'UTC'], { stdio: 'pipe' });
    const report = JSON.parse(await readFile(join(out, 'usage.json'), 'utf8'));
    assert.equal(report.schemaVersion, 2);
    assert.deepEqual(report.execution, data.execution);
    for (const file of ['index.html', 'usage.json', 'details.csv', 'sessions.csv', 'execution.csv']) {
      assert.ok(!(await readFile(join(out, file), 'utf8')).includes('PRIVATE_'), file);
      if (process.platform !== 'win32') assert.equal((await stat(join(out, file))).mode & 0o777, 0o600);
    }
    const csv = await readFile(join(out, 'execution.csv'), 'utf8');
    assert.ok(csv.startsWith('\uFEFF"date","source",'));
    assert.ok(csv.includes('"{""3"":1}"'), 'Histogram is exported as safely quoted JSON');
    assert.equal(csv.trim().split('\n').length, 2);
    const roundTrip = normalizeData(report, { timeZone: 'UTC', prices: {} });
    assert.deepEqual(roundTrip.execution, data.execution);
    const adjacent = await parsePiSessionJsonl({ source: 'oh-my-pi', sessionsDirs: [root] });
    assert.equal(adjacent.execution, undefined, 'Only native Pi has supported execution evidence');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('execution-only sources are not empty and missing usage is not synthesized as zero', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-usage-no-usage-'));
  try {
    const entries = fixture('2026-01-01T00:00:00Z');
    delete entries[1].message.usage;
    await writeFile(join(root, 'fixture.jsonl'), entries.map(JSON.stringify).join('\n'));
    const raw = await parsePiSessionJsonl({ source, sessionsDirs: [root] });
    t.mock.method(parsers, source, async () => ({ ...raw, buckets: [], sessions: [] }));
    const data = await collect({ sources: [source], timeZone: 'UTC', prices: {} });
    assert.equal(data.statuses[0].state, 'ok');
    assert.equal(data.execution[0].fullInputTokens, null);
    assert.equal(summarizeExecution(data.execution).inputSamples, 0);
    assert.deepEqual(normalizeData({ buckets: [], sessions: [] }, { timeZone: 'UTC', prices: {} }).execution, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
