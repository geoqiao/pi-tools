import test from 'node:test';
import assert from 'node:assert/strict';
import { createCounterfactualCache, counterfactualOptionsKey } from '../src/web/counterfactual-cache.js';
import { DEFAULT_COUNTERFACTUAL_OPTIONS as estimatorDefaults } from '../src/counterfactual.js';
import {
  COUNTERFACTUAL_OPTION_DEFINITIONS,
  DEFAULT_COUNTERFACTUAL_OPTIONS,
  validateCounterfactualOptions,
} from '../src/web/counterfactual-options.js';

test('Node estimator and browser controls share counterfactual defaults and validation', () => {
  assert.strictEqual(estimatorDefaults, DEFAULT_COUNTERFACTUAL_OPTIONS);
  assert.deepEqual(DEFAULT_COUNTERFACTUAL_OPTIONS, {
    toolsPerRound: 1,
    cache: 'observed',
    extraOutputTokens: 0,
    toolContextTokens: 0,
    codeOverheadTokens: 0,
    outputReplayShare: 0,
  });
  assert.deepEqual(Object.keys(COUNTERFACTUAL_OPTION_DEFINITIONS), Object.keys(DEFAULT_COUNTERFACTUAL_OPTIONS));
  assert.deepEqual(validateCounterfactualOptions({
    toolsPerRound: 'all', cache: 0.25, extraOutputTokens: 12,
    toolContextTokens: 34, codeOverheadTokens: 56, outputReplayShare: 0.75,
  }), {
    toolsPerRound: 'all', cache: 0.25, extraOutputTokens: 12,
    toolContextTokens: 34, codeOverheadTokens: 56, outputReplayShare: 0.75,
  });
  assert.deepEqual(validateCounterfactualOptions({}), DEFAULT_COUNTERFACTUAL_OPTIONS);
  const invalid = [
    null, [], { toolsPerRound: 0 }, { toolsPerRound: 1001 }, { toolsPerRound: 1.5 },
    { cache: -0.1 }, { cache: 'warm' }, { outputReplayShare: 1.1 },
    { extraOutputTokens: -1 }, { toolContextTokens: 1000001 }, { codeOverheadTokens: 1.2 },
  ];
  for (const options of invalid) assert.throws(() => validateCounterfactualOptions(options), String(options));
});

test('counterfactual cache reuses selected and sensitivity scenarios without stale row data', () => {
  const rows = [{ id: 'first' }], nextRows = [{ id: 'second' }];
  const options = validateCounterfactualOptions({ toolsPerRound: 1 });
  let calls = 0;
  const cache = createCounterfactualCache((input, settings) => ({ call: ++calls, input, settings }));
  assert.equal(typeof counterfactualOptionsKey(options), 'string');
  const selected = cache.get(rows, options);
  assert.strictEqual(cache.get(rows, { ...options }), selected);
  assert.equal(calls, 1);
  const sensitivity = cache.get(rows, { ...options, toolsPerRound: 2 });
  assert.notStrictEqual(sensitivity, selected);
  assert.equal(calls, 2);
  assert.strictEqual(cache.get(rows, { ...options, toolsPerRound: 2 }), sensitivity);
  assert.strictEqual(cache.get(nextRows, options).input, nextRows);
  assert.equal(calls, 3);
  cache.clear();
  assert.equal(cache.get(nextRows, options).call, 4);
});
