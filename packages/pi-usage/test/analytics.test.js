import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData, summarize, quantile, simulateModels, percentileRows, dailyRows, detailRows, selectData, toCsv, dateKey, validatePrices, findRate } from '../src/analytics.js';

const rate = { input: 5, cacheRead: 0.5, output: 30, reasoning: 30 };
const bucket = (extra = {}) => ({ source: 'pi-coding-agent', model: 'test', project: 'project', bucketStart: '2026-09-01T00:00:00Z', inputTokens: 1e6, cachedInputTokens: 2e6, outputTokens: 100000, reasoningOutputTokens: 100000, ...extra });
const normalize = rows => normalizeData({ buckets: rows, sessions: [] }, { timeZone: 'UTC', prices: { test: rate } }).buckets;

test('token categories, cost components, unknown prices and allow-listed privacy fields', () => {
  const rows = normalize([bucket({ prompt: 'secret', token: 'secret', estimatedCost: 999 }), bucket({ model: 'unknown' })]);
  assert.equal(rows[0].estimatedCost, 12);
  assert.equal(rows[0].totalTokens, 1200000);
  assert.equal(rows[0].allTokens, 3200000);
  assert.equal(rows[0].prompt, undefined);
  assert.equal(rows[0].token, undefined);
  const total = summarize(rows);
  assert.equal(total.estimatedCost, null);
  assert.equal(total.knownCost, 12);
  assert.equal(total.coverage, 0.5);
  assert.equal(rows[1].estimatedCost, null);
  assert.equal(findRate('TEST', { test: rate }), rate);
  assert.equal(findRate('TeSt', { test: rate, TEST: { ...rate, input: 9 } }), null);
  assert.equal(normalize([bucket({ model: 'test#service_tier=fast' })])[0].estimatedCost, null);
});

test('linear quantiles, zero days and reprice-before-quantile (not marginal quantile sum)', () => {
  assert.equal(quantile([0, 10, 20, 30], .25), 7.5);
  assert.equal(quantile([], .5), null);
  const rows = normalize([bucket({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 0 }), bucket({ bucketStart: '2026-09-02T00:00:00Z', inputTokens: 100, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 })]);
  const days = dailyRows(rows, '2026-09-01', '2026-09-03');
  const scenario = simulateModels(days, ['equal'], { equal: { input: 1e6, output: 1e6, cacheRead: 0, reasoning: 1e6 } });
  assert.deepEqual(scenario[0].values, [100, 100, 100, 100]);
  assert.equal(dailyRows(rows, '2026-09-01', '2026-09-03', true).length, 3);
  assert.equal(days.length, 2);
  const partial = dailyRows(normalize([bucket(), bucket({ model: 'unknown' })]), '2026-09-01', '2026-09-01');
  assert.equal(percentileRows(partial).find(r => r.metric === 'estimatedCost').sampleDays, 0);
});

test('daily details merge times, preserve every dimension and unknown pricing', () => {
  const rows = normalize([
    bucket({ project: 'a|b', bucketStart: '2026-09-01T00:00:00Z' }),
    bucket({ project: 'a|b', bucketStart: '2026-09-01T00:30:00Z' }),
    bucket({ project: 'a', hostname: 'b|unknown' }),
    bucket({ project: 'a|b', model: 'unknown' }),
    bucket({ project: 'a|b', source: 'other' }),
    bucket({ project: 'a|b', bucketStart: '2026-09-02T00:00:00Z' }),
  ]);
  const details = detailRows(rows);
  assert.equal(details.length, 5);
  assert.equal(details[0].allTokens, 6400000);
  assert.equal(details[0].estimatedCost, 24);
  assert.equal(details[0].coverage, 1);
  assert.equal(details[0].bucketStart, undefined);
  assert.equal(details.find(row => row.model === 'unknown').estimatedCost, null);
  assert.equal(details.find(row => row.model === 'unknown').coverage, 0);
  assert.equal(details.reduce((sum, row) => sum + row.allTokens, 0), summarize(rows).allTokens);
  const days = dailyRows(rows, '2026-09-01', '2026-09-03', true);
  assert.equal(days[0].recorded, true);
  assert.equal(days[2].recorded, false);
  assert.equal(days[2].allTokens, 0);
  const simulations = simulateModels(dailyRows(rows, '2026-09-01', '2026-09-02'), ['test'], { test: rate });
  assert.ok(simulations[0].values.every(value => value > 0), 'Unknown original prices must not exclude workload from target simulation');
});

test('timezone day boundaries and model filtering never fabricate session attribution', () => {
  assert.equal(dateKey('2026-09-01T23:30:00Z', 'Asia/Shanghai'), '2026-09-02');
  assert.equal(dateKey('2026-03-08T07:30:00Z', 'America/New_York'), '2026-03-08');
  const data = { buckets: normalize([bucket()]), sessions: [{ source: 'pi-coding-agent', project: 'project', hostname: 'unknown', date: '2026-09-01' }] };
  const filters = { from: '2026-09-01', to: '2026-09-01', model: 'test' };
  assert.equal(selectData(data, filters).buckets.length, 1);
  assert.equal(selectData(data, filters).sessions.length, 0);
  assert.equal(selectData(data, { ...filters, model: '' }).sessions.length, 1);
});

test('validation fails on unsafe counts and malformed prices; CSV quotes and formula protection', () => {
  for (const value of [-1, NaN, Infinity, '9', .2]) assert.throws(() => normalize([bucket({ inputTokens: value })]));
  assert.throws(() => validatePrices({ test: { ...rate, input: -1 } }));
  assert.throws(() => validatePrices({ test: { ...rate, output: '30' } }));
  assert.throws(() => validatePrices(undefined));
  const csv = toCsv([{ project: '=1+1', model: 'a,"b\nc', estimatedCost: null }], ['project', 'model', 'estimatedCost']);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"a,""b\nc"'));
  assert.ok(csv.endsWith(',""\r\n'));
});
