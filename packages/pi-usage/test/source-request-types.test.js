import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse as codex } from '../vendor/vibe-usage/src/parsers/codex.js';
import { codexCacheDir } from '../vendor/vibe-usage/src/parsers/codex-cache.js';
import { parse as zcode } from '../vendor/vibe-usage/src/parsers/zcode.js';

// Synthetic protocol records only; never copy real conversations into fixtures.
const root = mkdtempSync(join(tmpdir(), 'pi-usage-source-types-'));
const env = { CODEX_HOME: join(root, 'codex'), PI_USAGE_CACHE_DIR: join(root, 'cache'), VIBE_USAGE_CINDY_DIRS: join(root, 'no-cindy'), VIBE_USAGE_KIMI_CODE_DIR: join(root, 'kimi'), VIBE_USAGE_KIMI_DIR: join(root, 'legacy') };
const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
Object.assign(process.env, env);
const { parse: kimi } = await import('../vendor/vibe-usage/src/parsers/kimi-code.js');
test.after(() => {
  for (const key of Object.keys(env)) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  rmSync(root, { recursive: true, force: true });
});
const timestamp = '2026-09-01T00:00:00Z';
const usage = { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 };
const row = (type, payload) => ({ timestamp, type, payload });
const item = (type, extra = {}) => row('response_item', { type, ...extra });
const text = () => item('message', { role: 'assistant', content: [{ type: 'output_text', text: 'synthetic' }] });
const start = () => row('event_msg', { type: 'task_started', turn_id: 'turn' });
const count = (n, extra = {}) => row('event_msg', { type: 'token_count', info: { last_token_usage: usage, total_token_usage: { total_tokens: 120 * n }, ...extra } });
const record = (id = 'r', extra = {}) => row('token_usage_record', { thread_id: 's', turn_id: 'turn', response_id: id, usage, ...extra });
const jsonl = rows => rows.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n';
function codexFile(rows) {
  rmSync(env.CODEX_HOME, { recursive: true, force: true });
  rmSync(env.PI_USAGE_CACHE_DIR, { recursive: true, force: true });
  mkdirSync(join(env.CODEX_HOME, 'sessions'), { recursive: true });
  const path = join(env.CODEX_HOME, 'sessions', 's.jsonl');
  writeFileSync(path, jsonl([row('session_meta', { id: 's', cwd: '/synthetic/project' }), ...rows]));
  return path;
}
const fields = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'];
const totals = buckets => fields.map(key => buckets.reduce((n, b) => n + b[key], 0));
const classified = buckets => Object.fromEntries(buckets.map(b => [b.requestType ?? 'other', fields.reduce((n, key) => n + b[key], 0)]));

test('Codex partitions whole requests: text + parallel calls, final text, no evidence; duplicates count once', async () => {
  codexFile([start(), text(), item('function_call'), item('custom_tool_call'), item('function_call_output'), item('custom_tool_call_output'), count(1), count(1), text(), count(2), count(3)]);
  const result = await codex();
  assert.deepEqual(totals(result.buckets), [180, 120, 45, 15]);
  assert.deepEqual(classified(result.buckets), { tool: 120, non_tool: 120, other: 120 });
});

test('Codex completion ledger is evidence, not another usage source; result events are not calls', async () => {
  codexFile([start(), text(), item('custom_tool_call'), record(), record(), row('event_msg', { type: 'item_completed', item: { type: 'ToolCall' } }), item('custom_tool_call_output'), count(1), text(), record('r2'), count(2), record('unmatched')]);
  const result = await codex();
  assert.deepEqual(totals(result.buckets), [120, 80, 30, 10]);
  assert.deepEqual(classified(result.buckets), { tool: 120, non_tool: 120 });
});

test('Codex unsafe intervals remain other without changing usage', async () => {
  const cases = [
    [item('function_call'), count(1)], // no start / legacy truncated history
    [start(), text(), '{broken', count(1)],
    [start(), text(), row('response_item', null), count(1)],
    [start(), item('function_call'), row('event_msg', { type: 'user_message' }), text(), count(1)],
    [start(), item('function_call'), row('compacted', {}), count(1)],
    [start(), item('function_call'), row('event_msg', { type: 'turn_aborted' }), count(1)],
    [start(), text(), item('unrecognized_call'), count(1)],
    [start(), item('function_call', { internal_chat_message_metadata_passthrough: { turn_id: 'other-turn' } }), count(1)],
    [start(), item('function_call', { response_id: 'one' }), text(), record('two'), count(1)],
    [start(), item('function_call'), record('one'), record('two'), count(1)],
    [start(), item('function_call'), record('one', { thread_id: 'other-thread' }), count(1)],
    [start(), text(), record('one', { usage: { ...usage, output_tokens: 99 } }), count(1)],
    [start(), text(), count(0)], // zero cumulative counters cannot prove completion
    [start(), item('function_call'), count(1, { last_token_usage: null, total_token_usage: usage })],
  ];
  for (const rows of cases) {
    codexFile(rows);
    const result = await codex();
    assert.deepEqual(totals(result.buckets), [60, 40, 15, 5]);
    assert.deepEqual(classified(result.buckets), { other: 120 });
  }
});

test('Codex duplicate rate-limit emissions do not consume next response evidence', async () => {
  codexFile([start(), text(), count(1), item('function_call'), count(1), row('event_msg', { type: 'token_count', info: null }), item('custom_tool_call'), count(2)]);
  assert.deepEqual(classified((await codex()).buckets), { non_tool: 120, tool: 120 });
});

test('Codex cache reuse, mid-response append, completion-record append and algorithm invalidation', async () => {
  const path = codexFile([start(), text(), count(1), item('function_call')]);
  const cold = await codex();
  assert.deepEqual((await codex()).buckets, cold.buckets);
  appendFileSync(path, jsonl([record('r2')]));
  const pending = await codex();
  assert.equal(pending.cache.tailHits, 1);
  assert.deepEqual(pending.buckets, cold.buckets);
  appendFileSync(path, jsonl([item('function_call_output'), count(2), text(), count(3)]));
  const appended = await codex();
  assert.equal(appended.cache.tailHits, 1);
  assert.deepEqual(classified(appended.buckets), { non_tool: 240, tool: 120 });
  assert.deepEqual((await codex()).buckets, appended.buckets);
  const dir = codexCacheDir(env.CODEX_HOME);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), cache = JSON.parse(readFileSync(path, 'utf8'));
    cache.algorithmVersion = 3;
    writeFileSync(path, JSON.stringify(cache));
  }
  const rebuilt = await codex();
  assert.equal(rebuilt.cache.resultHits, 0);
  assert.equal(rebuilt.cache.tailHits, 0);
  assert.deepEqual(rebuilt.buckets, appended.buckets);
});

test('Codex replay and archived copies preserve classification without multiplying totals', async () => {
  const parent = [start(), item('function_call'), count(1)];
  codexFile(parent);
  mkdirSync(join(env.CODEX_HOME, 'archived_sessions'));
  writeFileSync(join(env.CODEX_HOME, 'archived_sessions', 'copy.jsonl'), readFileSync(join(env.CODEX_HOME, 'sessions', 's.jsonl')));
  writeFileSync(join(env.CODEX_HOME, 'sessions', 'fork.jsonl'), jsonl([
    row('session_meta', { id: 'child', forked_from_id: 's', timestamp, cwd: '/synthetic/project' }),
    ...parent, start(), text(), count(2),
  ]));
  const result = await codex();
  assert.deepEqual(classified(result.buckets), { tool: 120, non_tool: 120 });
  assert.deepEqual((await codex()).buckets, result.buckets);
});

function zcodeDb(parts = true) {
  const path = join(root, 'zcode.sqlite');
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE session (id TEXT, directory TEXT); CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);');
  if (parts) db.exec('CREATE TABLE part (message_id TEXT, data TEXT);');
  const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  for (const [id, finish] of [['tools', 'stop'], ['plain', 'stop'], ['filtered', 'content-filter'], ['unfinished', null], ['corrupt', 'stop']]) {
    insert.run(id, 'session', Date.parse(timestamp), JSON.stringify({ role: 'assistant', modelID: 'test', finish, tokens: { input: 100, output: 20, cache: { read: 40 }, reasoning: 5 } }));
  }
  if (parts) db.exec(`INSERT INTO part VALUES ('tools', '{"type":"tool"}'), ('tools', '{"type":"tool"}'), ('unfinished', '{"type":"text"}'), ('corrupt', '{bad'), ('unrelated', '{"type":"tool"}');`);
  db.close();
  return path;
}

test('ZCode exact message_id join, multiple tools, finish requirement, malformed parts and missing schema', async () => {
  const result = await zcode({ dbPath: zcodeDb() });
  assert.deepEqual(classified(result.buckets), { tool: 120, non_tool: 120, other: 360 });
  assert.deepEqual(totals(result.buckets), [300, 200, 75, 25]);
  const legacy = await zcode({ dbPath: zcodeDb(false) });
  assert.deepEqual(classified(legacy.buckets), { other: 600 });
  assert.deepEqual(totals(legacy.buckets), totals(result.buckets));
});

const ku = { inputOther: 60, inputCacheRead: 40, output: 20, inputCacheCreation: 0 };
const wire = (type, rest = {}) => ({ type, time: Date.parse(timestamp), ...rest });
const loop = (type, rest = {}) => wire('context.append_loop_event', { event: { type, uuid: 'step', turnId: 'turn', step: 1, ...rest } });
const begin = () => loop('step.begin');
const tool = (rest = {}) => loop('tool.call', { stepUuid: 'step', toolCallId: 'call', ...rest });
const end = (finishReason = 'end_turn', rest = {}) => loop('step.end', { usage: ku, finishReason, ...rest });
const billed = (rest = {}) => wire('usage.record', { model: 'test', usage: ku, usageScope: 'turn', ...rest });
function kimiFile(rows, legacy = false) {
  rmSync(env.VIBE_USAGE_KIMI_CODE_DIR, { recursive: true, force: true });
  rmSync(env.VIBE_USAGE_KIMI_DIR, { recursive: true, force: true });
  const dir = legacy ? join(env.VIBE_USAGE_KIMI_DIR, 'sessions', 'project', 'session') : join(env.VIBE_USAGE_KIMI_CODE_DIR, 'sessions', 'wd_project_abcd', 'session', 'agents', 'main');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wire.jsonl'), jsonl(rows));
}

test('Kimi current matches step UUID + complete usage, mixed and parallel calls classify once', async () => {
  kimiFile([begin(), loop('content.part', { stepUuid: 'step', part: { type: 'text' } }), tool(), tool(), end(), billed(), begin(), end(), billed(), billed({ usageScope: 'session' })]);
  const result = await kimi();
  assert.deepEqual(classified(result.buckets), { tool: 120, non_tool: 120, other: 120 });
  assert.deepEqual(totals(result.buckets), [180, 120, 60, 0]);
});

test('Kimi current scope is not evidence: missing/mismatched/interleaved/truncated steps stay other', async () => {
  const cases = [
    [billed()], [end('tool_use'), billed()],
    [begin(), tool(), billed()],
    [begin(), tool({ stepUuid: 'different' }), end(), billed()],
    [begin(), end('end_turn', { uuid: 'different' }), billed()],
    [begin(), end('length'), billed()],
    [begin(), end(), billed({ usageScope: 'session' })],
    [begin(), end('tool_use', { usage: { ...ku, output: 99 } }), billed()],
    [begin(), tool(), '{malformed', end(), billed()],
    [begin(), wire('context.append_loop_event', { event: 'malformed' }), end(), billed()],
    [begin(), tool(), wire('turn.cancel'), end(), billed()],
    [begin(), tool(), begin(), end(), billed()],
  ];
  for (const rows of cases) {
    kimiFile(rows);
    assert.deepEqual(classified((await kimi()).buckets), { other: 120 });
  }
});

test('Kimi current duplicate evidence does not double usage, repeated unlinked billing stays other', async () => {
  kimiFile([begin(), tool(), tool(), end('tool_use'), end('tool_use'), billed(), billed()]);
  const result = await kimi();
  assert.deepEqual(classified(result.buckets), { tool: 120, other: 120 });
  assert.deepEqual(totals(result.buckets), [120, 80, 40, 0]);
});

const legacy = (type, payload = {}) => ({ timestamp: Date.parse(timestamp) / 1000, message: { type, payload } });
const status = id => legacy('StatusUpdate', { message_id: id, token_usage: { input_other: 60, input_cache_read: 40, output: 20 } });
const part = () => legacy('ContentPart', { type: 'text', text: 'synthetic' });
const call = () => legacy('ToolCall', { id: 'call', type: 'function', function: { name: 'test' } });

test('Kimi legacy full-step completion, duplicate message IDs and positive tool evidence merge', async () => {
  kimiFile([legacy('StepBegin'), part(), status('a'), legacy('StepBegin'), part(), call(), call(), status('a'), legacy('StepBegin'), part(), status('b'), status('c')], true);
  const result = await kimi();
  assert.deepEqual(classified(result.buckets), { tool: 120, non_tool: 120, other: 120 });
  assert.deepEqual(totals(result.buckets), [180, 120, 60, 0]);
});

test('Kimi legacy retry, compaction, malformed and nested subagent evidence cannot leak', async () => {
  kimiFile([
    legacy('StepBegin'), call(), legacy('StepRetry'), part(), status('retry'),
    legacy('StepBegin'), call(), legacy('CompactionBegin'), status('compact'), legacy('CompactionEnd'), part(), status('after'),
    legacy('StepBegin'), call(), '{broken', status('broken'),
    legacy('StepBegin'), part(), legacy('SubagentEvent', { event: { type: 'ToolCall', payload: { id: 'child' } } }), status('parent'),
    legacy('StepBegin'), call(), legacy('StepInterrupted'), status('interrupted'),
    legacy('StepBegin'), call(), legacy('StatusUpdate', { token_usage: { input_other: 0, output: 0 } }), status('after-zero'),
  ], true);
  assert.deepEqual(classified((await kimi()).buckets), { non_tool: 360, other: 480 });
});
