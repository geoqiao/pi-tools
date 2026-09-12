// Counterfactual controls are a shared contract: Node validation and the report UI
// must agree on defaults and bounds. The estimator owns the pricing formula.
export const COUNTERFACTUAL_OPTION_DEFINITIONS = Object.freeze({
  toolsPerRound: Object.freeze({ default: 1, min: 1, max: 1000, integer: true, special: 'all' }),
  cache: Object.freeze({ default: 'observed', min: 0, max: 1, special: 'observed' }),
  extraOutputTokens: Object.freeze({ default: 0, min: 0, max: 1000000, integer: true, step: 1 }),
  toolContextTokens: Object.freeze({ default: 0, min: 0, max: 1000000, integer: true, step: 1 }),
  codeOverheadTokens: Object.freeze({ default: 0, min: 0, max: 1000000, integer: true, step: 1 }),
  outputReplayShare: Object.freeze({ default: 0, min: 0, max: 1, step: 0.01 }),
});

export const DEFAULT_COUNTERFACTUAL_OPTIONS = Object.freeze(Object.fromEntries(
  Object.entries(COUNTERFACTUAL_OPTION_DEFINITIONS).map(([key, definition]) => [key, definition.default]),
));

export function validateCounterfactualOptions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('情景参数必须是对象');
  const out = Object.fromEntries(Object.entries(DEFAULT_COUNTERFACTUAL_OPTIONS)
    .map(([key, value]) => [key, Object.hasOwn(raw, key) ? raw[key] : value]));
  const batching = COUNTERFACTUAL_OPTION_DEFINITIONS.toolsPerRound;
  if (out.toolsPerRound !== batching.special
    && (!Number.isInteger(out.toolsPerRound) || out.toolsPerRound < batching.min || out.toolsPerRound > batching.max)) {
    throw new Error('每轮工具数需为 1–1000 的整数或 all');
  }
  const cache = COUNTERFACTUAL_OPTION_DEFINITIONS.cache;
  if (out.cache !== cache.special
    && (typeof out.cache !== 'number' || !Number.isFinite(out.cache) || out.cache < cache.min || out.cache > cache.max)) {
    throw new Error('缓存比例需为 observed 或 0–1 的数值');
  }
  const replay = COUNTERFACTUAL_OPTION_DEFINITIONS.outputReplayShare;
  if (typeof out.outputReplayShare !== 'number' || !Number.isFinite(out.outputReplayShare)
    || out.outputReplayShare < replay.min || out.outputReplayShare > replay.max) {
    throw new Error('输出回放比例需为 0–1 的数值');
  }
  const tokenDefinitions = ['extraOutputTokens', 'toolContextTokens', 'codeOverheadTokens'];
  for (const key of tokenDefinitions) {
    const definition = COUNTERFACTUAL_OPTION_DEFINITIONS[key];
    if (!Number.isInteger(out[key]) || out[key] < definition.min || out[key] > definition.max) {
      throw new Error('输出、上下文和开销假设需为 0–1000000 的整数');
    }
  }
  return out;
}
