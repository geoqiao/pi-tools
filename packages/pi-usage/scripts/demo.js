// Synthetic data only; never include a personal report in a package or screenshot fixture.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { normalizeData, shiftDate } from '../src/analytics.js';
import { writeReport } from '../src/report.js';
const snapshot = JSON.parse(await readFile(new URL('../data/prices.json', import.meta.url), 'utf8'));
const buckets = [], sessions = [], execution = [];
const requestedDays = Number(process.argv[3] ?? process.env.PI_USAGE_DEMO_DAYS ?? 90);
const demoDays = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 3660 ? requestedDays : 90;
const to = '2026-09-05', from = shiftDate(to, 1 - demoDays);
const modelIds = ['gpt-5.4', 'claude-sonnet-4-6', 'deepseek-v4-flash', 'unknown-preview'];
// Exercise truncation, HTML escaping and CSV formula protection with synthetic names.
const projectIds = ['atlas', 'paper-trail', 'pi-tools', '=lab,"<svg onload=alert(1)>", ' + 'long-project/'.repeat(24)];
const digest = (value, length) => createHash('sha256').update(`synthetic-execution-${value}`).digest('hex').slice(0, length);
const executionBase = (date, day, index, extra = {}) => ({
  source: 'pi-coding-agent', provider: day % 2 ? 'synthetic-provider-a' : 'synthetic-provider-b',
  model: ['gpt-5.4', 'claude-sonnet-4-6', 'execution-only-preview'][index % 3],
  project: index % 3 === 2 ? 'execution-only-project' : 'execution-lab', hostname: 'synthetic-workstation',
  requestType: index % 2 ? 'tool' : 'non_tool', timestamp: `${date}T${String(4 + index).padStart(2, '0')}:00:00Z`,
  sessionHash: digest(0x100000000 + day * 16 + index, 16), responseHash: digest(0x900000000 + day * 16 + index, 24),
  mode: 'unknown', fullInputTokens: null, cacheReadTokens: null, outputTokens: null,
  outerToolCalls: 0, execCalls: 0, waitCalls: 0, execHistogram: {}, pendingExecs: 0, unknownExecs: 0,
  incompleteToolCalls: 0, outerExecErrors: 0, nestedToolErrors: 0, shellNonzero: 0, ...extra,
});
for (let d = 0; d < demoDays; d++) {
  if (d % 11 === 0) continue;
  for (let m = 0; m < 4; m++) {
    const date = shiftDate(from, d);
    const scale = ((d * 17 + m * 11) % 61 + 4) * 4700;
    buckets.push({ source: ['codex', 'claude-code', 'pi-coding-agent', 'pi-coding-agent'][m], model: modelIds[m], requestType: ['non_tool', 'tool', 'other'][(d + m) % 3], project: projectIds[m], hostname: 'local-device', bucketStart: `${date}T${String((d + m * 3) % 24).padStart(2, '0')}:00:00Z`, inputTokens: scale, cachedInputTokens: scale * 12, outputTokens: Math.floor(scale / 12), reasoningOutputTokens: Math.floor(scale / 18) });
    sessions.push({ source: buckets.at(-1).source, project: buckets.at(-1).project, hostname: 'local-device', sessionHash: `demo-${d}-${m}`, firstMessageAt: `${date}T08:00:00Z`, lastMessageAt: `${date}T09:00:00Z`, durationSeconds: 3600, activeSeconds: 1400 + d, messageCount: 60, userMessageCount: 8 });
  }
  if (d % 9 !== 0) {
    const date = shiftDate(from, d);
    if (d % 10 !== 0) execution.push(executionBase(date, d, 0, {
      model: d % 4 === 0 ? 'execution-only-preview' : 'gpt-5.4', project: d % 4 === 0 ? 'execution-only-project' : 'execution-lab',
      requestType: 'tool', mode: 'code_mode', fullInputTokens: 18000 + d * 73, cacheReadTokens: 6200 + d * 19, outputTokens: 640 + d,
      outerToolCalls: 4, execCalls: 3, waitCalls: 1, execHistogram: { 0: 1, 1: 1, 5: 1 },
    }));
    execution.push(executionBase(date, d, 1, {
      model: d % 3 === 0 ? 'claude-sonnet-4-6' : 'gpt-5.4', project: 'execution-lab',
      requestType: 'tool', mode: 'code_mode', fullInputTokens: d % 2 ? 21000 + d * 41 : null, cacheReadTokens: d % 2 ? 5000 + d * 11 : null, outputTokens: d % 2 ? 820 + d : null,
      outerToolCalls: 3, execCalls: 2, waitCalls: 1, execHistogram: d % 10 === 0 ? {} : { 2: 1 }, pendingExecs: d % 10 === 0 ? 2 : 1, incompleteToolCalls: 1,
    }));
    execution.push(executionBase(date, d, 2, {
      model: 'execution-only-preview', project: 'execution-only-project', requestType: 'tool', mode: 'code_mode',
      fullInputTokens: null, cacheReadTokens: null, outputTokens: null, outerToolCalls: 2, execCalls: 2,
      execHistogram: d % 10 === 0 ? {} : { 1: 1 }, unknownExecs: d % 10 === 0 ? 2 : 1, incompleteToolCalls: 2,
    }));
    execution.push(executionBase(date, d, 3, {
      model: d % 2 ? 'claude-sonnet-4-6' : 'gpt-5.4', project: 'execution-lab', requestType: 'non_tool', mode: 'no_tools',
      fullInputTokens: 9000 + d * 17, cacheReadTokens: 1000 + d * 3, outputTokens: 300 + d, outerToolCalls: 0,
    }));
    execution.push(executionBase(date, d, 4, {
      model: 'execution-only-preview', project: 'execution-only-project', requestType: 'tool', mode: 'other_tools',
      fullInputTokens: 11000 + d * 13, cacheReadTokens: 1500 + d * 2, outputTokens: 260 + d, outerToolCalls: 1,
    }));
    execution.push(executionBase(date, d, 5, {
      model: 'execution-only-preview', project: 'execution-only-project', requestType: 'tool', mode: 'unknown',
      fullInputTokens: null, cacheReadTokens: null, outputTokens: null, outerToolCalls: 1, execCalls: 1, unknownExecs: 1,
    }));
  }
}
const data = normalizeData({ buckets, sessions, execution }, { timeZone: 'Asia/Shanghai', prices: snapshot.models });
// Keep the synthetic report internally consistent with its declared inclusive date window.
// Bucket timestamps are intentionally varied across UTC hours, so local-day conversion can
// otherwise create a row just outside [from, to].
const inReportWindow = row => row.date >= from && row.date <= to;
data.buckets = data.buckets.filter(inReportWindow);
data.sessions = data.sessions.filter(inReportWindow);
data.execution = data.execution.filter(inReportWindow);
const demoSources = ['codex', 'claude-code', 'pi-coding-agent'];
const statusesFor = reportData => demoSources.map(source => ({
  source, state: 'ok', buckets: reportData.buckets.filter(row => row.source === source).length,
  sessions: reportData.sessions.filter(row => row.source === source).length,
  note: '合成演示 Harness；不是真实使用记录。execution 也为人工合成证据。',
}));
const common = { schemaVersion: 2, timeZone: 'Asia/Shanghai', generatedAt: '2026-09-05T10:00:00Z', priceSnapshot: { date: snapshot.snapshotDate, source: snapshot.source, overrideCount: 0 }, prices: snapshot.models };
const scope = { kind: 'selected', sources: demoSources, offline: true };
const mainReport = { ...common, from, to, collectionScope: scope, ...data, statuses: statusesFor(data) };
const output = process.argv[2];
const mainPath = await writeReport(mainReport, output);
const associatedPaths = [mainPath];
if (output) {
  // Keep browser acceptance fixtures beside the arbitrary demo directory. They
  // are synthetic variants, never copies of a developer's usage report.
  const shortFrom = shiftDate(to, 1 - 30);
  const shortData = {
    ...data,
    buckets: data.buckets.filter(row => row.date >= shortFrom && row.date <= to),
    sessions: data.sessions.filter(row => row.date >= shortFrom && row.date <= to),
    execution: data.execution.filter(row => row.date >= shortFrom && row.date <= to),
  };
  const shortReport = { ...common, from: shortFrom, to, collectionScope: scope, ...shortData, statuses: statusesFor(shortData) };
  associatedPaths.push(await writeReport(shortReport, join(output, 'short')));
  const { collectionScope: _scope, execution: _execution, ...legacyReport } = shortReport;
  associatedPaths.push(await writeReport(legacyReport, join(output, 'legacy')));
}
console.log(associatedPaths.join('\n'));
