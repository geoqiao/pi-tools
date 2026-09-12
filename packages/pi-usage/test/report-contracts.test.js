import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { renderReport, bundleBrowserScript, EXECUTION_COLUMNS as reportExecutionColumns } from '../src/report.js';
import { COUNTERFACTUAL_CSV_COLUMNS, EXECUTION_COLUMNS as sharedExecutionColumns } from '../src/web/report-contracts.js';

test('execution and counterfactual exports keep their established column order', () => {
  assert.strictEqual(reportExecutionColumns, sharedExecutionColumns);
  assert.deepEqual([...sharedExecutionColumns], [
    'date', 'source', 'provider', 'model', 'project', 'hostname', 'requestType', 'timestamp',
    'sessionHash', 'responseHash', 'mode', 'fullInputTokens', 'cacheReadTokens', 'outputTokens',
    'outerToolCalls', 'execCalls', 'waitCalls', 'execHistogram', 'pendingExecs', 'unknownExecs',
    'incompleteToolCalls', 'outerExecErrors', 'nestedToolErrors', 'shellNonzero',
  ]);
  assert.deepEqual([...COUNTERFACTUAL_CSV_COLUMNS], [
    'scenario', 'filterFrom', 'filterTo', 'filterSource', 'filterModel', 'filterProject',
    'filterHostname', 'filterRequestType', 'executionRows', 'toolsPerRound', 'cache',
    'outputReplayShare', 'extraOutputTokens', 'toolContextTokens', 'codeOverheadTokens',
    'assumption', 'candidateRows', 'candidateExecs', 'eligibleRows', 'eligibleExecs',
    'excludedMissingExec', 'excludedZeroTools', 'excludedMissingUsage', 'pricedRows',
    'priceCoverage', 'priceSnapshotDate', 'priceOverrideCount', 'addedResponses',
    'removedOutputTokens', 'addedInputTokens', 'addedCachedTokens', 'addedUncachedTokens',
    'actualInputTokens', 'actualOutputTokens', 'actualTotalTokens', 'actualCost',
    'knownActualCost', 'directInputTokens', 'directOutputTokens', 'directTotalTokens',
    'directCost', 'knownDirectCost', 'deltaInputTokens', 'deltaOutputTokens', 'deltaTotalTokens',
    'deltaCost', 'knownDeltaCost',
  ]);
});

test('browser bundling accepts only the report’s no-alias named imports', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-usage-bundle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dependency = join(directory, 'dependency.js');
  await writeFile(dependency, 'export const value = 1;\n');
  const entry = join(directory, 'entry.js');
  const unsupported = [
    'import value from \'./dependency.js\';',
    'import * as dependency from \'./dependency.js\';',
    'import { value as other } from \'./dependency.js\';',
  ];
  for (const statement of unsupported) {
    await writeFile(entry, `${statement}\nvalue;\n`);
    await assert.rejects(
      bundleBrowserScript(pathToFileURL(entry).href),
      /无别名 named import/,
      statement,
    );
  }
  await writeFile(entry, "import { value } from './dependency.js';\nvalue;\n");
  const bundle = await bundleBrowserScript(pathToFileURL(entry).href);
  assert.doesNotThrow(() => new Script(`(() => {\n${bundle.dependencies}\n${bundle.entry}\n})();`));
});

test('embedded report declares DATA before invoking the browser entry', async () => {
  const html = await renderReport({ buckets: [], sessions: [], execution: [] });
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.equal((script.match(/^\s*(?:import|export)\b/gm) ?? []).length, 0);
  assert.ok(script.indexOf('const DATA = ') < script.indexOf('for (const row of DATA.buckets)'));
});
