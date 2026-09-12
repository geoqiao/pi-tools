// Small per-filter memo for the finite set of counterfactual scenarios.
export function counterfactualOptionsKey(options) {
  return JSON.stringify([
    options.toolsPerRound, options.cache, options.outputReplayShare,
    options.extraOutputTokens, options.toolContextTokens, options.codeOverheadTokens,
  ]);
}

export function createCounterfactualCache(estimate) {
  if (typeof estimate !== 'function') throw new TypeError('情景估算器必须是函数');
  let rows = null;
  const results = new Map();
  const clear = () => {
    rows = null;
    results.clear();
  };
  const get = (nextRows, options) => {
    if (rows !== nextRows) {
      rows = nextRows;
      results.clear();
    }
    const key = counterfactualOptionsKey(options);
    if (!results.has(key)) results.set(key, estimate(nextRows, options));
    return results.get(key);
  };
  return { get, clear };
}
