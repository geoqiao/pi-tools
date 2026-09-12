// Browser and Node report export schemas. Keep column order stable for consumers.
export const EXECUTION_COLUMNS = Object.freeze([
  'date', 'source', 'provider', 'model', 'project', 'hostname', 'requestType', 'timestamp',
  'sessionHash', 'responseHash', 'mode', 'fullInputTokens', 'cacheReadTokens', 'outputTokens',
  'outerToolCalls', 'execCalls', 'waitCalls', 'execHistogram', 'pendingExecs', 'unknownExecs',
  'incompleteToolCalls', 'outerExecErrors', 'nestedToolErrors', 'shellNonzero',
]);

export const COUNTERFACTUAL_CSV_COLUMNS = Object.freeze([
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
