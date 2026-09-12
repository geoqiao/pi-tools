// Shared by Node and the self-contained report. No filesystem or network access.
import { normalizeExecutionRows } from './execution.js';
export const TOKEN_FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'];
export const DIMENSIONS = ['source', 'model', 'project', 'hostname', 'requestType'];
export const REQUEST_TYPES = { non_tool: '非工具调用请求', tool: '含工具调用请求', other: '其他（无法判定）' };
export const QUANTILES = [0.25, 0.5, 0.75, 0.9];

export function requestTypeFor(message) {
  const stop = message.stopReason ?? message.stop_reason;
  if (['toolUse', 'tool_use'].includes(stop) || (Array.isArray(message.content) && message.content.some(block => ['toolCall', 'tool_use', 'server_tool_use'].includes(block?.type)))) return 'tool';
  return Array.isArray(message.content) && ['stop', 'end_turn', 'stop_sequence'].includes(stop) ? 'non_tool' : 'other';
}

// Multiple fragments/copies can carry one request's usage. Positive tool evidence wins.
export function mergeRequestTypes(a, b) {
  return [a, b].includes('tool') ? 'tool' : [a, b].includes('non_tool') ? 'non_tool' : 'other';
}

const dateFormatters = new Map();
export function dateKey(value, timeZone) {
  if (!dateFormatters.has(timeZone)) dateFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const parts = dateFormatters.get(timeZone).formatToParts(new Date(value));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftDate(day, amount) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

// Display only: raw exports, pricing and aggregation retain token counts.
const millionFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
export function tokenMillions(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 1) return value < 0 ? '−<0.000001 M' : '<0.000001 M';
  return `${millionFormatter.format(value / 1e6)} M`;
}

// A static report cannot fetch missing days. Never silently clamp a named range.
export function reportDatePreset(from, to, preset) {
  const validDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && shiftDate(day, 0) === day;
  if (!validDate(from) || !validDate(to) || from > to) throw new RangeError('Invalid report date range');
  if (!['7', '30', '90', 'all'].includes(preset)) throw new RangeError('Unknown date preset');
  const requestedFrom = preset === 'all' ? from : shiftDate(to, 1 - Number(preset));
  return { from: requestedFrom, to, requestedFrom, available: requestedFrom >= from };
}

export function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function validatePrices(models) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('价格表 models 必须是对象');
  for (const [id, rate] of Object.entries(models)) {
    if (!id || !rate || typeof rate !== 'object' || Array.isArray(rate)) throw new Error(`无效价格：${id}`);
    for (const key of ['input', 'output', 'cacheRead', 'reasoning']) {
      if (key === 'cacheRead' && rate[key] === null) continue;
      if (typeof rate[key] !== 'number' || !Number.isFinite(rate[key]) || rate[key] < 0) throw new Error(`${id}.${key} 必须是非负有限数值（美元 / 百万 token）`);
    }
  }
  return models;
}

export function findRate(model, models) {
  // Whole identifiers only: never discard service-tier suffixes or match by substring.
  if (Object.hasOwn(models, model)) return models[model];
  const matches = Object.keys(models).filter(id => id.toLowerCase() === model.toLowerCase());
  return matches.length === 1 ? models[matches[0]] : null;
}

export function priceTokens(row, rate) {
  if (!rate || (row.cachedInputTokens > 0 && rate.cacheRead == null)) return null;
  const costs = {
    inputCost: row.inputTokens * rate.input / 1e6,
    cacheCost: row.cachedInputTokens * (rate.cacheRead ?? 0) / 1e6,
    outputCost: row.outputTokens * rate.output / 1e6,
    reasoningCost: row.reasoningOutputTokens * rate.reasoning / 1e6,
  };
  return { ...costs, estimatedCost: Object.values(costs).reduce((a, b) => a + b, 0) };
}

function text(value, fallback = 'unknown') {
  return typeof value === 'string' && value ? value.slice(0, 500) : fallback;
}
function count(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('无效计数：必须是非负安全整数');
  return value;
}
function iso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('无效时间戳');
  return new Date(value).toISOString();
}

export function normalizeData(raw, { timeZone, hostname = 'unknown', prices }) {
  if (!Array.isArray(raw?.buckets) || !Array.isArray(raw?.sessions)) throw new Error('输入需要 buckets 和 sessions 数组');
  // Allow-list fields: no prompts, message bodies, credentials or arbitrary parser payloads in exports.
  const buckets = raw.buckets.map(row => {
    const b = Object.fromEntries(DIMENSIONS.map(k => [k, text(row[k], k === 'hostname' ? hostname : 'unknown')]));
    if (row.requestType != null && !Object.hasOwn(REQUEST_TYPES, row.requestType)) throw new Error('无效请求类型');
    b.requestType = row.requestType ?? 'other';
    b.bucketStart = iso(row.bucketStart);
    b.date = dateKey(b.bucketStart, timeZone);
    for (const k of TOKEN_FIELDS) b[k] = count(row[k] ?? 0);
    b.totalTokens = count(b.inputTokens + b.outputTokens + b.reasoningOutputTokens);
    b.allTokens = count(b.totalTokens + b.cachedInputTokens);
    const priced = priceTokens(b, findRate(b.model, prices));
    return { ...b, ...(priced || { inputCost: null, cacheCost: null, outputCost: null, reasoningCost: null, estimatedCost: null }) };
  });
  const sessions = raw.sessions.map(row => {
    const s = Object.fromEntries(['source', 'project', 'hostname'].map(k => [k, text(row[k], k === 'hostname' ? hostname : 'unknown')]));
    s.firstMessageAt = iso(row.firstMessageAt);
    s.lastMessageAt = iso(row.lastMessageAt);
    if (s.lastMessageAt < s.firstMessageAt) throw new Error('会话结束时间早于开始时间');
    s.date = dateKey(s.firstMessageAt, timeZone);
    s.sessionHash = text(row.sessionHash, 'unknown');
    for (const k of ['durationSeconds', 'activeSeconds', 'messageCount', 'userMessageCount']) s[k] = count(row[k] ?? 0);
    return s;
  });
  return { buckets, sessions, execution: normalizeExecutionRows(raw.execution, { timeZone, hostname }) };
}

export function summarize(rows) {
  const out = Object.fromEntries([...TOKEN_FIELDS, 'totalTokens', 'allTokens', 'knownCost', 'pricedTokens', 'inputCost', 'cacheCost', 'outputCost', 'reasoningCost'].map(k => [k, 0]));
  out.unpricedRows = 0;
  for (const row of rows) {
    for (const k of [...TOKEN_FIELDS, 'totalTokens', 'allTokens']) out[k] += row[k];
    if (row.estimatedCost == null && row.allTokens > 0) out.unpricedRows++;
    else {
      out.knownCost += row.estimatedCost || 0;
      out.pricedTokens += row.allTokens;
      for (const k of ['inputCost', 'cacheCost', 'outputCost', 'reasoningCost']) out[k] += row[k] || 0;
    }
  }
  out.estimatedCost = out.unpricedRows ? null : out.knownCost;
  out.coverage = out.allTokens ? out.pricedTokens / out.allTokens : null;
  return out;
}

export function groupRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = typeof key === 'function' ? key(row) : row[key];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return [...groups].map(([name, items]) => ({ name, ...summarize(items) }));
}

export function detailRows(rows) {
  const keys = ['date', ...DIMENSIONS];
  return groupRows(rows, row => JSON.stringify(keys.map(key => row[key]))).map(({ name, ...totals }) => {
    const values = JSON.parse(name);
    return { ...Object.fromEntries(keys.map((key, i) => [key, values[i]])), ...totals };
  });
}

export function selectData(data, filters) {
  const matches = row => row.date >= filters.from && row.date <= filters.to
    && DIMENSIONS.every(k => !filters[k] || row[k] === filters[k]);
  return {
    buckets: data.buckets.filter(matches),
    // Upstream sessions have no model: suppress instead of inventing a join.
    sessions: filters.model || filters.requestType ? [] : data.sessions.filter(matches),
  };
}

export function dailyRows(rows, from, to, includeZero = false) {
  const days = new Map(groupRows(rows, 'date').map(r => [r.name, { ...r, recorded: true }]));
  if (includeZero) {
    for (let day = from; day <= to; day = shiftDate(day, 1)) {
      if (!days.has(day)) days.set(day, { name: day, ...summarize([]), recorded: false });
    }
  }
  return [...days.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function percentileRows(days) {
  return [...TOKEN_FIELDS, 'totalTokens', 'allTokens', 'estimatedCost'].map(metric => {
    // Never present partial known-cost subtotals as the distribution of full daily cost.
    const values = days.map(d => d[metric]).filter(v => v != null);
    return { metric, sampleDays: values.length, min: quantile(values, 0), max: quantile(values, 1), values: QUANTILES.map(p => quantile(values, p)) };
  });
}

export function simulateModels(days, modelIds, prices) {
  return [...new Set(modelIds)].sort().map(model => {
    const rate = findRate(model, prices);
    const repriced = days.map(day => priceTokens(day, rate)?.estimatedCost ?? null);
    const complete = rate && repriced.length && repriced.every(v => v != null);
    return { model, rate, sampleDays: days.length, min: complete ? quantile(repriced, 0) : null, max: complete ? quantile(repriced, 1) : null, values: QUANTILES.map(p => complete ? quantile(repriced, p) : null) };
  });
}

export function toCsv(rows, columns) {
  const cell = value => {
    let s = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@\t\r\n]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map(r => columns.map(k => cell(r[k])).join(','))].join('\r\n') + '\r\n';
}
