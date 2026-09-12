import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCodeModeCost } from '../src/counterfactual.js';
import { normalizeExecutionRows } from '../src/execution.js';

const prices = { synthetic: { input: 2, cacheRead: .5, output: 10, reasoning: 10 } };
const sample = extra => normalizeExecutionRows([{
  source: 'pi-coding-agent', provider: 'synthetic', model: 'synthetic', project: 'synthetic', hostname: 'fixture',
  timestamp: '2026-01-01T00:00:00Z', sessionHash: 'a'.repeat(16), responseHash: 'b'.repeat(24),
  requestType: 'tool', mode: 'code_mode', fullInputTokens: 100, cacheReadTokens: 80, outputTokens: 20,
  outerToolCalls: 1, execCalls: 1, waitCalls: 0, execHistogram: { 3: 1 }, pendingExecs: 0, unknownExecs: 0,
  incompleteToolCalls: 0, outerExecErrors: 0, nestedToolErrors: 0, shellNonzero: 0, ...extra,
}], { timeZone: 'UTC' })[0];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('default serial rounds replay the prefix without assuming reasoning output becomes input', () => {
  const s = estimateCodeModeCost([sample()], prices);
  assert.equal(s.candidateRows, 1); assert.equal(s.eligibleRows, 1);
  assert.equal(s.addedResponses, 2);
  assert.equal(s.actual.totalTokens, 120);
  assert.equal(s.options.outputReplayShare, 0);
  assert.equal(s.addedInputTokens, 200);
  assert.equal(s.addedCachedTokens, 160); assert.equal(s.addedUncachedTokens, 40);
  assert.equal(s.direct.totalTokens, 320); assert.equal(s.delta.totalTokens, 200);
  close(s.actual.cost, .00028); close(s.direct.cost, .00044); close(s.delta.cost, .00016);
});

test('output retention is an input assumption only; generated output remains fully priced', () => {
  const row = sample(), options = { extraOutputTokens: 7 };
  const none = estimateCodeModeCost([row], prices, options);
  const partial = estimateCodeModeCost([row], prices, { ...options, outputReplayShare: .25 });
  const all = estimateCodeModeCost([row], prices, { ...options, outputReplayShare: 1 });
  assert.equal(none.direct.outputTokens, 34);
  assert.equal(partial.direct.outputTokens, 34); assert.equal(all.direct.outputTokens, 34);
  assert.equal(partial.addedInputTokens, 212, 'Round 20*.25→5 and 7*.25→2 before replay');
  assert.equal(all.addedInputTokens, 247);
  assert.ok(none.direct.cost < partial.direct.cost && partial.direct.cost < all.direct.cost);
  assert.equal(estimateCodeModeCost([row], prices, { toolsPerRound: 'all', outputReplayShare: 1 }).direct.cost,
    estimateCodeModeCost([row], prices, { toolsPerRound: 'all', outputReplayShare: 0 }).direct.cost);
});

test('batching uses all inner tools in one assistant anchor, not per-exec savings', () => {
  const row = sample({ outerToolCalls: 2, execCalls: 2, execHistogram: { 1: 1, 2: 1 } });
  assert.equal(estimateCodeModeCost([row], prices).addedResponses, 2);
  assert.equal(estimateCodeModeCost([row], prices, { toolsPerRound: 2 }).addedResponses, 1);
  const all = estimateCodeModeCost([row], prices, { toolsPerRound: 'all' });
  assert.equal(all.addedResponses, 0); assert.equal(all.delta.totalTokens, 0); assert.equal(all.delta.cost, 0);
});

test('growth/output/overhead parameters agree with a per-round reconstruction at warm cache', () => {
  const s = estimateCodeModeCost([sample()], prices, { cache: 1, extraOutputTokens: 10, toolContextTokens: 5, codeOverheadTokens: 4, outputReplayShare: 1 });
  // Added inputs: 121 = repeat100 + fresh21; 136 = repeat121 + fresh15.
  assert.equal(s.addedInputTokens, 257);
  assert.equal(s.addedCachedTokens, 221); assert.equal(s.addedUncachedTokens, 36);
  assert.equal(s.direct.outputTokens, 36); assert.equal(s.delta.totalTokens, 273);
  assert.equal(s.removedOutputTokens, 4); close(s.delta.cost, .0003425);
});

test('removing hypothetical Code Mode output overhead can make direct calls cheaper', () => {
  const s = estimateCodeModeCost([sample()], prices, { toolsPerRound: 'all', codeOverheadTokens: 999 });
  assert.equal(s.removedOutputTokens, 20, 'Deduction is capped at observed output');
  assert.equal(s.direct.outputTokens, 0); assert.equal(s.delta.totalTokens, -20);
  close(s.delta.cost, -.0002); close(s.direct.cost, .00008);
});

test('empty, unknown, pending, pure-JS and missing usage never become zero-price eligible samples', () => {
  const s = estimateCodeModeCost([
    sample({ mode: 'unknown', execHistogram: {}, unknownExecs: 1 }),
    sample({ execHistogram: {}, pendingExecs: 1 }),
    sample({ execHistogram: { 0: 1 } }),
    sample({ fullInputTokens: null, cacheReadTokens: null }),
    sample({ execCalls: 0, execHistogram: {}, mode: 'other_tools' }),
  ], prices);
  assert.equal(s.candidateRows, 4); assert.equal(s.eligibleRows, 0);
  assert.deepEqual(s.excluded, { missingExec: 2, zeroTools: 1, missingUsage: 1 });
  assert.equal(s.actual.totalTokens, null); assert.equal(s.direct.cost, null);
  assert.equal(s.knownActualCost, null); assert.equal(s.delta.cost, null);
  assert.equal(estimateCodeModeCost([], prices).delta.totalTokens, null);
});

test('money compares an identical priced subset; unknown model still has token estimates', () => {
  const s = estimateCodeModeCost([sample(), sample({ model: 'unpriced' })], prices);
  assert.equal(s.eligibleRows, 2); assert.equal(s.pricedRows, 1);
  assert.equal(s.actual.totalTokens, 240); assert.equal(s.direct.totalTokens, 640);
  assert.equal(s.actual.cost, null); assert.equal(s.direct.cost, null); assert.equal(s.delta.cost, null);
  close(s.knownActualCost, .00028); close(s.knownDirectCost, .00044); close(s.knownDeltaCost, .00016);
});

test('cache sensitivity changes money not token totals; missing cache fee and distinct reasoning fee stay unknown', () => {
  const cold = estimateCodeModeCost([sample()], prices, { cache: 0, outputReplayShare: 1 });
  const warm = estimateCodeModeCost([sample()], prices, { cache: 1, outputReplayShare: 1 });
  assert.equal(cold.direct.totalTokens, warm.direct.totalTokens);
  assert.ok(cold.direct.cost > warm.direct.cost);
  assert.equal(warm.addedUncachedTokens, 20, 'Fresh initial output is not a cache hit');
  const noCacheFee = { synthetic: { ...prices.synthetic, cacheRead: null } };
  assert.equal(estimateCodeModeCost([sample({ cacheReadTokens: 0 })], noCacheFee, { cache: 0 }).pricedRows, 1);
  assert.equal(estimateCodeModeCost([sample({ cacheReadTokens: 0 })], noCacheFee, { cache: 1 }).pricedRows, 0);
  assert.equal(estimateCodeModeCost([sample()], { synthetic: { ...prices.synthetic, reasoning: 12 } }).pricedRows, 0);
});

test('zero-rate eligible samples are free in this price basis, unlike unavailable samples', () => {
  const s = estimateCodeModeCost([sample()], { synthetic: { input: 0, cacheRead: 0, output: 0, reasoning: 0 } });
  assert.equal(s.pricedRows, 1); assert.equal(s.actual.cost, 0); assert.equal(s.direct.cost, 0);
});

test('heterogeneous models and input/cache sizes are priced per anchor, never with an average rate', () => {
  const rates = { ...prices, other: { input: 7, cacheRead: 1.2, output: 31, reasoning: 31 } };
  const rows = [sample(), sample({ model: 'other', fullInputTokens: 2000, cacheReadTokens: 100,
    outputTokens: 300, execHistogram: { 5: 1 } })];
  const settings = { toolsPerRound: 2, extraOutputTokens: 15, toolContextTokens: 30, codeOverheadTokens: 4 };
  const combined = estimateCodeModeCost(rows, rates, settings);
  const pieces = rows.map(row => estimateCodeModeCost([row], rates, settings));
  assert.equal(combined.pricedRows, 2);
  for (const cohort of ['actual','direct','delta']) {
    assert.equal(combined[cohort].totalTokens, pieces.reduce((sum,s) => sum+s[cohort].totalTokens,0));
    close(combined[cohort].cost, pieces.reduce((sum,s) => sum+s[cohort].cost,0));
  }
  assert.equal(estimateCodeModeCost([sample({ model: 'synthetic-priority' })], rates).pricedRows, 0,
    'Service-tier suffixes are not silently aliased to a base price');
});

test('invalid assumptions and numerical overflow are rejected without mutating inputs', () => {
  const row = sample(), before = JSON.stringify(row);
  for (const options of [{ toolsPerRound: 0 }, { toolsPerRound: 2.5 }, { cache: 1.1 }, { cache: 'warm' },
    { extraOutputTokens: -1 }, { codeOverheadTokens: null }, { toolContextTokens: Infinity },
    { outputReplayShare: -1 }, { outputReplayShare: 1.1 }, { outputReplayShare: null }]) {
    assert.throws(() => estimateCodeModeCost([row], prices, options));
  }
  assert.throws(() => estimateCodeModeCost([sample({ execHistogram: { [Number.MAX_SAFE_INTEGER]: 1 } })], prices), /范围|过大/);
  assert.equal(JSON.stringify(row), before);
});

test('closed-form estimates match explicit per-round prefix/cache replay across 3456 synthetic scenarios', () => {
  for (let tools = 1; tools <= 8; tools++) {
    const row = sample({ execHistogram: { [tools]: 1 } });
    for (const B of [1,2,4,'all']) for (const g of [0,3]) for (const q of [0,2])
      for (const d of [0,7,100]) for (const h of [0,.3,1]) for (const r of [0,.5,1]) {
        const options = { toolsPerRound: B, toolContextTokens: g, extraOutputTokens: q, codeOverheadTokens: d, cache: h, outputReplayShare: r };
        const s = estimateCodeModeCost([row], prices, options);
        const rounds = B === 'all' ? 0 : Math.ceil(tools/B)-1;
        const U = 20-Math.min(d,20);
        let prefix = 100, previousOutput = Math.round(U*r), input = 0, cached = 0, uncached = 0;
        for (let j = 0; j < rounds; j++) {
          const newContext = previousOutput+g;
          cached += prefix*h;
          uncached += prefix*(1-h)+newContext;
          prefix += newContext;
          input += prefix;
          previousOutput = Math.round(q*r);
        }
        assert.equal(s.addedInputTokens,input);
        close(s.addedCachedTokens,cached); close(s.addedUncachedTokens,uncached);
        assert.equal(s.direct.totalTokens,100+input+U+rounds*q);
        close(s.direct.cost,(80+uncached*2+cached*.5+(U+rounds*q)*10)/1e6);
        close(s.delta.cost,s.direct.cost-s.actual.cost);
      }
  }
});
