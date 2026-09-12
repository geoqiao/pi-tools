import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExecutionRows, summarizeExecution, selectExecution, groupExecution } from '../src/execution.js';
import { createPiExecutionCollector } from '../src/pi-execution.js';

const sample = (overrides = {}) => ({
  source: 'pi-coding-agent', provider: 'test-provider', model: 'synthetic-model',
  project: 'synthetic-project', hostname: 'fixture-host', requestType: 'tool',
  timestamp: '2026-01-02T23:30:00Z', sessionHash: 'a'.repeat(16), responseHash: 'b'.repeat(24),
  mode: 'code_mode', fullInputTokens: 120, cacheReadTokens: 80, outputTokens: 10,
  outerToolCalls: 3, execCalls: 3, waitCalls: 0, execHistogram: { 0: 1, 1: 1, 4: 1 },
  pendingExecs: 0, unknownExecs: 0, incompleteToolCalls: 0,
  outerExecErrors: 1, nestedToolErrors: 0, shellNonzero: 0, ...overrides,
});
test('execution normalizer is allow-listed, nullable, timezone-aware and validates counts', () => {
  const [row] = normalizeExecutionRows([sample({ prompt: 'PRIVATE', args: { command: 'PRIVATE' } })], { timeZone: 'Asia/Shanghai' });
  assert.equal(row.date, '2026-01-03');
  assert.ok(!JSON.stringify(row).includes('PRIVATE'));
  assert.equal(normalizeExecutionRows(undefined, { timeZone: 'UTC' }).length, 0);
  assert.throws(() => normalizeExecutionRows([sample({ execCalls: 9 })], { timeZone: 'UTC' }), /exec|执行/i);
  assert.throws(() => normalizeExecutionRows([sample({ execHistogram: { '-1': 3 } })], { timeZone: 'UTC' }));
  assert.throws(() => normalizeExecutionRows([sample({ fullInputTokens: -1 })], { timeZone: 'UTC' }));
  assert.throws(() => normalizeExecutionRows([sample({ cacheReadTokens: 200 })], { timeZone: 'UTC' }));
});

test('histograms merge before quantiles, with pending and unknown outside the exact denominator', () => {
  const rows = normalizeExecutionRows([
    sample(),
    sample({ responseHash: 'c'.repeat(24), execCalls: 3, execHistogram: { 2: 1 }, pendingExecs: 1, unknownExecs: 1,
      incompleteToolCalls: 9, fullInputTokens: null, cacheReadTokens: null }),
  ], { timeZone: 'UTC' });
  const s = summarizeExecution(rows);
  assert.equal(s.responseCount, 2); assert.equal(s.inputSamples, 1);
  assert.equal(s.averageInputTokens, 120); assert.equal(s.cacheReadShare, null);
  assert.equal(s.execCalls, 6); assert.equal(s.completeExecs, 4);
  assert.equal(s.innerToolCalls, 7); assert.equal(s.incompleteToolCalls, 9);
  assert.equal(s.meanTools, 1.75); assert.equal(s.medianTools, 1.5);
  assert.equal(s.p75Tools, 2.5); assert.equal(s.multiToolRate, .5);
  assert.equal(groupExecution(rows, 'model')[0].medianTools, 1.5);
  assert.equal(summarizeExecution([]).medianTools, null);
  assert.equal(summarizeExecution([]).averageInputTokens, null);
  assert.equal(selectExecution({ execution: rows }, { from: '2026-01-02', to: '2026-01-02', model: 'absent' }).length, 0);
  assert.equal(selectExecution({}, { from: '2026-01-01', to: '2026-01-03' }).length, 0);
});

const ctx = { sessionId: 'synthetic-session', project: 'fixture-project' };
const assistant = (id, content, extra = {}) => ({
  id, type: 'message', timestamp: '2026-01-02T12:00:00Z',
  message: { role: 'assistant', provider: 'synthetic-provider', model: 'synthetic-model',
    responseId: 'response-' + id, stopReason: 'toolUse', usage: { input: 7, cacheRead: 20, cacheWrite: 3, output: 5 },
    content, ...extra },
});
const call = (id, name = 'exec', args = {}) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id, details, extra = {}) => ({
  type: 'message', timestamp: '2026-01-02T12:00:01Z',
  message: { role: 'toolResult', toolCallId: id, toolName: 'exec', isError: false, content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }], details, ...extra },
});
const trace = (id, name = 'exec_command', exit = 0) => ({
  id, name, status: 'done', input: { cmd: 'PRIVATE_COMMAND' },
  result: { details: { exit_code: exit }, content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }] },
});
function feed(entries) {
  const c = createPiExecutionCollector('pi-coding-agent'); c.beginFile();
  for (const e of entries) c.observe(e, ctx);
  return c.finish();
}
test('exec / wait snapshots form one execution and deduplicate traces / response copies', () => {
  const a = assistant('a', [call('exec-1')]);
  const { rows } = feed([
    a, a,
    result('exec-1', { codeMode: true, cellId: 'cell', status: 'yielded', traces: [trace('t1')] }),
    assistant('b', [call('wait-1', 'wait', { cell_id: 'cell' })], { model: 'second-model' }),
    result('wait-1', { codeMode: true, cellId: 'cell', status: 'result', traces: [trace('t1'), trace('t2')] }, { toolName: 'wait' }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].execHistogram, { 2: 1 });
  assert.equal(rows[0].execCalls, 1); assert.equal(rows[1].execCalls, 0);
  assert.equal(rows[1].waitCalls, 1); assert.equal(rows[0].model, 'synthetic-model');
  assert.equal(rows[0].fullInputTokens, 30);
  const serialized = JSON.stringify(rows);
  for (const secret of ['PRIVATE_COMMAND', 'PRIVATE_OUTPUT', 'response-a', 'synthetic-session', 'exec-1', 'cell']) assert.ok(!serialized.includes(secret), secret);
});
test('dropped trace counter restores count without double counting earlier snapshots', () => {
  const { rows } = feed([
    assistant('a', [call('e')]),
    result('e', { codeMode: true, cellId: 'x', status: 'yielded', traces: [trace('old-1'), trace('old-2')] }),
    assistant('b', [call('w', 'wait', { cell_id: 'x' })]),
    result('w', { codeMode: true, cellId: 'x', status: 'result', droppedTraceCount: 2, traces: [trace('new-1'), trace('new-2')] }, { toolName: 'wait' }),
  ]);
  assert.deepEqual(rows[0].execHistogram, { 4: 1 });
});
test('genuine zero-tool errors differ from missing results, missing schema and pending executions', () => {
  const { rows } = feed([
    assistant('a', [call('zero'), call('missing'), call('unknown'), call('pending')]),
    result('zero', { codeMode: true, cellId: 'a', status: 'result', scriptError: 'bad syntax' }, { isError: true }),
    result('unknown', {}),
    result('pending', { codeMode: true, cellId: 'b', status: 'yielded', traces: [trace('t')] }),
  ]);
  assert.deepEqual(rows[0].execHistogram, { 0: 1 });
  assert.equal(rows[0].unknownExecs, 2); assert.equal(rows[0].pendingExecs, 1);
  assert.equal(rows[0].incompleteToolCalls, 1); assert.equal(rows[0].outerExecErrors, 1);
});
test('reused runtime cell ids do not merge separate execs; errors and shell exits stay separate', () => {
  const bad = { id: 'error-t', name: 'apply_patch', status: 'error', error: 'PRIVATE_ERROR' };
  const { rows } = feed([
    assistant('a', [call('first')]),
    result('first', { codeMode: true, cellId: '1', status: 'result', traces: [trace('one', 'exec_command', 2)] }),
    assistant('b', [call('second')]),
    result('second', { codeMode: true, cellId: '1', status: 'result', traces: [bad] }),
  ]);
  assert.deepEqual(rows.map(r => r.execHistogram), [{ 1: 1 }, { 1: 1 }]);
  assert.equal(rows[0].shellNonzero, 1); assert.equal(rows[0].outerExecErrors, 0);
  assert.equal(rows[1].nestedToolErrors, 1);
});
test('partial usage remains null and ordinary native tools are not Code Mode off evidence', () => {
  const { rows } = feed([assistant('a', [call('b','bash')], { usage: { input: 7, output: 2 } }),
    assistant('b', [], { stopReason: 'stop' })]);
  assert.equal(rows[0].fullInputTokens, null); assert.equal(rows[0].mode, 'other_tools');
  assert.equal(rows[1].mode, 'no_tools');
  assert.equal(rows[0].execCalls, 0);
});

test('corrupt trace shapes and mismatched wait cells never become exact samples', () => {
  for (const traces of [null, [{ id: 't' }], [{ ...trace('t'), status: 'unexpected' }]]) {
    const { rows } = feed([assistant('a', [call('e')]),
      result('e', { codeMode: true, cellId: 'x', status: 'result', traces })]);
    assert.equal(rows[0].unknownExecs, 1);
    assert.deepEqual(rows[0].execHistogram, {});
  }
  const { rows } = feed([
    assistant('a', [call('e')]),
    result('e', { codeMode: true, cellId: 'x', status: 'yielded', traces: [trace('one')] }),
    assistant('b', [call('w', 'wait', { cell_id: 'x' })]),
    result('w', { codeMode: true, cellId: 'different-cell', status: 'result', traces: [trace('one'), trace('two')] }),
  ]);
  assert.equal(rows[0].unknownExecs, 1);
  assert.deepEqual(rows[0].execHistogram, {});
});

test('copied files deduplicate responses while orphan results produce only a generic warning', () => {
  const c = createPiExecutionCollector('pi-coding-agent');
  for (const sessionId of ['original', 'fork']) {
    c.beginFile();
    c.observe(assistant('a', [call('e')]), { ...ctx, sessionId });
    c.observe(result('e', { codeMode: true, cellId: 'x', status: 'result', traces: [trace('t')] }), { ...ctx, sessionId });
  }
  c.beginFile();
  c.observe(result('PRIVATE_UNLINKED_ID', { codeMode: true, cellId: 'PRIVATE_CELL', status: 'result' }), ctx);
  const { rows, warnings } = c.finish();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].execHistogram, { 1: 1 });
  assert.equal(warnings.length, 1);
  assert.ok(!JSON.stringify({ rows, warnings }).includes('PRIVATE'));
});

test('pending dropped counts form a lower bound and contradictory final counters stay unknown', () => {
  const entries = [assistant('a', [call('e')]),
    result('e', { codeMode: true, cellId: 'x', status: 'yielded', traces: [trace('t')], droppedTraceCount: 10 })];
  const pending = feed(entries).rows[0];
  assert.equal(pending.pendingExecs, 1);
  assert.equal(pending.incompleteToolCalls, 11);
  const terminal = feed([...entries,
    assistant('b', [call('w', 'wait', { cell_id: 'x' })]),
    result('w', { codeMode: true, cellId: 'x', status: 'result', traces: [trace('t')] }),
  ]).rows[0];
  assert.equal(terminal.unknownExecs, 1);
  assert.deepEqual(terminal.execHistogram, {});
  assert.equal(terminal.incompleteToolCalls, 11);
});

test('a new wait after completion cannot invalidate a previously exact exec', () => {
  const { rows } = feed([
    assistant('a', [call('e')]),
    result('e', { codeMode: true, cellId: 'x', status: 'result', traces: [trace('t')] }),
    assistant('b', [call('late-wait', 'wait', { cell_id: 'x' })]),
    result('late-wait', {}, { isError: true }),
  ]);
  assert.deepEqual(rows[0].execHistogram, { 1: 1 });
  assert.equal(rows[0].outerExecErrors, 0, 'An unrelated late wait error is not an exec failure');
  assert.equal(rows[1].waitCalls, 1);
});

test('copied continuations and repeated final wait records keep their original association', () => {
  const c = createPiExecutionCollector('pi-coding-agent');
  for (let copy = 0; copy < 2; copy++) {
    c.beginFile();
    for (const entry of [
      assistant('a', [call('e')]),
      result('e', { codeMode: true, cellId: 'x', status: 'yielded', traces: [trace('t')] }),
      assistant('b', [call('w', 'wait', { cell_id: 'x' })]),
      result('w', { codeMode: true, cellId: 'x', status: 'result', traces: [trace('t'), trace('t2')] }),
      assistant('b', [call('w', 'wait', { cell_id: 'x' })]),
      result('w', { codeMode: true, cellId: 'x', status: 'result', traces: [trace('t'), trace('t2')] }),
    ]) c.observe(entry, ctx);
  }
  const { rows, warnings } = c.finish();
  assert.deepEqual(rows[0].execHistogram, { 2: 1 });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].waitCalls, 1);
  assert.deepEqual(warnings, []);
});
