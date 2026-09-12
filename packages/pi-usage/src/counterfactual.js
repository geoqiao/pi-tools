// Local fixed-history scenarios, not measured whole-session savings.
import { findRate } from './analytics.js';

export const DEFAULT_COUNTERFACTUAL_OPTIONS = Object.freeze({
  toolsPerRound: 1, cache: 'observed', extraOutputTokens: 0, toolContextTokens: 0, codeOverheadTokens: 0, outputReplayShare: 0,
});

function cfFinite(value) {
  if (!Number.isFinite(value)) throw new Error('情景估算数值过大，超出可计算范围');
  return value;
}
function cfTokens(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('情景 Token 数超出安全范围');
  return value;
}
function cfOptions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('情景参数必须是对象');
  const out = Object.fromEntries(Object.entries(DEFAULT_COUNTERFACTUAL_OPTIONS)
    .map(([key,value]) => [key,Object.hasOwn(raw,key) ? raw[key] : value]));
  if (out.toolsPerRound !== 'all' && (!Number.isInteger(out.toolsPerRound) || out.toolsPerRound < 1 || out.toolsPerRound > 1000)) throw new Error('每轮工具数需为 1–1000 的整数或 all');
  if (out.cache !== 'observed' && (typeof out.cache !== 'number' || !Number.isFinite(out.cache) || out.cache < 0 || out.cache > 1)) throw new Error('缓存比例需为 observed 或 0–1 的数值');
  if (typeof out.outputReplayShare !== 'number' || !Number.isFinite(out.outputReplayShare) || out.outputReplayShare < 0 || out.outputReplayShare > 1) throw new Error('输出回放比例需为 0–1 的数值');
  for (const key of ['extraOutputTokens','toolContextTokens','codeOverheadTokens']) {
    if (!Number.isInteger(out[key]) || out[key] < 0 || out[key] > 1000000) throw new Error('输出、上下文和开销假设需为 0–1000000 的整数');
  }
  return out;
}
function cfRate(model, prices, cachedTokens) {
  const rate = findRate(model,prices);
  // The execution export has inclusive output, not a reliable reasoning split.
  if (!rate || rate.output !== rate.reasoning) return null;
  for (const key of ['input','output',...(cachedTokens > 0 ? ['cacheRead'] : [])]) {
    if (typeof rate[key] !== 'number' || !Number.isFinite(rate[key]) || rate[key] < 0) return null;
  }
  return rate;
}

export function estimateCodeModeCost(rows, prices = {}, options = {}) {
  const settings = cfOptions(options);
  if (!Array.isArray(rows)) throw new Error('执行情景需要响应数组');
  const out = { options: settings, candidateRows: 0, candidateExecs: 0, eligibleRows: 0, eligibleExecs: 0,
    excluded: { missingExec: 0, zeroTools: 0, missingUsage: 0 },
    addedResponses: 0, removedOutputTokens: 0, addedInputTokens: 0, addedCachedTokens: 0, addedUncachedTokens: 0,
    actual: { inputTokens: null, outputTokens: null, totalTokens: null, cost: null },
    direct: { inputTokens: null, outputTokens: null, totalTokens: null, cost: null },
    delta: { inputTokens: null, outputTokens: null, totalTokens: null, cost: null },
    pricedRows: 0, knownActualCost: null, knownDirectCost: null, knownDeltaCost: null };
  let actualInput = 0, actualOutput = 0, directInput = 0, directOutput = 0, actualCost = 0, directCost = 0;
  for (const row of rows) {
    if (!(row?.execCalls > 0)) continue;
    out.candidateRows++; out.candidateExecs = cfTokens(out.candidateExecs + row.execCalls);
    const histogram = Object.entries(row.execHistogram ?? {});
    if (row.mode !== 'code_mode' || row.pendingExecs || row.unknownExecs
      || histogram.reduce((sum,[,n]) => cfTokens(sum+n),0) !== row.execCalls) {
      out.excluded.missingExec++; continue;
    }
    const tools = histogram.reduce((sum,[k,n]) => cfTokens(sum+Number(k)*n),0);
    if (!tools) { out.excluded.zeroTools++; continue; }
    const P = row.fullInputTokens, C = row.cacheReadTokens, O = row.outputTokens;
    if (![P,C,O].every(n => Number.isSafeInteger(n) && n >= 0) || P === 0 || C > P) {
      out.excluded.missingUsage++; continue;
    }
    out.eligibleRows++; out.eligibleExecs = cfTokens(out.eligibleExecs + row.execCalls);
    // Several execs in one assistant response still share ONE starting round.
    const a = settings.toolsPerRound === 'all' ? 0 : Math.max(Math.ceil(tools/settings.toolsPerRound)-1,0);
    const q = settings.extraOutputTokens, g = settings.toolContextTokens;
    const deduction = Math.min(settings.codeOverheadTokens,O), U = O-deduction;
    // Output includes reasoning. Generated tokens are NOT necessarily replayed
    // as input: explicitly parameterize retention rather than assume it is 100%.
    const V = Math.round(U*settings.outputReplayShare), Q = Math.round(q*settings.outputReplayShare);
    const addedInput = cfTokens(a*(P+V) + g*a*(a+1)/2 + Q*a*(a-1)/2);
    // Only previously seen prefixes may be cached. New output/tool context is
    // fresh on its first appearance, even in the 100%-warm-cache scenario.
    const reusable = cfTokens(a*P + Math.max(a-1,0)*V + g*a*(a-1)/2
      + Q*Math.max(a-1,0)*Math.max(a-2,0)/2);
    const fresh = cfTokens(addedInput-reusable);
    const cacheShare = settings.cache === 'observed' ? C/P : settings.cache;
    const extraCached = cfFinite(reusable*cacheShare), extraUncached = cfFinite(fresh+reusable-extraCached);
    const nextInput = cfTokens(P+addedInput), nextOutput = cfTokens(U+a*q);
    out.addedResponses = cfTokens(out.addedResponses+a);
    out.removedOutputTokens = cfTokens(out.removedOutputTokens+deduction);
    out.addedInputTokens = cfTokens(out.addedInputTokens+addedInput);
    out.addedCachedTokens = cfFinite(out.addedCachedTokens+extraCached);
    out.addedUncachedTokens = cfFinite(out.addedUncachedTokens+extraUncached);
    actualInput = cfTokens(actualInput+P); actualOutput = cfTokens(actualOutput+O);
    directInput = cfTokens(directInput+nextInput); directOutput = cfTokens(directOutput+nextOutput);
    const rate = cfRate(row.model,prices,C+extraCached);
    if (rate) {
      const prefixCost = cfFinite((P-C)*rate.input + C*(rate.cacheRead ?? 0));
      actualCost = cfFinite(actualCost+(prefixCost+O*rate.output)/1e6);
      directCost = cfFinite(directCost+(prefixCost+extraUncached*rate.input+extraCached*(rate.cacheRead ?? 0)+nextOutput*rate.output)/1e6);
      out.pricedRows++;
    }
  }
  if (out.eligibleRows) {
    out.actual.inputTokens = actualInput; out.actual.outputTokens = actualOutput;
    out.actual.totalTokens = cfTokens(actualInput+actualOutput);
    out.direct.inputTokens = directInput; out.direct.outputTokens = directOutput;
    out.direct.totalTokens = cfTokens(directInput+directOutput);
    for (const key of ['inputTokens','outputTokens','totalTokens']) out.delta[key] = out.direct[key]-out.actual[key];
  }
  if (out.pricedRows) {
    out.knownActualCost = actualCost; out.knownDirectCost = directCost; out.knownDeltaCost = directCost-actualCost;
    if (out.pricedRows === out.eligibleRows) {
      out.actual.cost = actualCost; out.direct.cost = directCost; out.delta.cost = directCost-actualCost;
    }
  }
  return out;
}
