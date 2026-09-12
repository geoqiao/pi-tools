// Pure shared analytics; no filesystem, raw messages, tool arguments or network.
const EXECUTION_COUNTS = ['outerToolCalls', 'execCalls', 'waitCalls', 'pendingExecs', 'unknownExecs',
  'incompleteToolCalls', 'outerExecErrors', 'nestedToolErrors', 'shellNonzero'];
const EXECUTION_DIMENSIONS = ['source', 'model', 'project', 'hostname', 'requestType'];
const EXECUTION_MODES = ['code_mode', 'other_tools', 'no_tools', 'unknown'];

function executionCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('无效执行统计计数');
  return value;
}
function executionText(value, fallback = 'unknown') {
  return typeof value === 'string' && value ? value.slice(0, 500) : fallback;
}
function histogramCount(histogram) {
  return Object.values(histogram).reduce((a, b) => executionCount(a + b), 0);
}

export function normalizeExecutionRows(raw, { timeZone, hostname = 'unknown' }) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('execution 必须是数组');
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return raw.map(item => {
    if (!item || typeof item !== 'object') throw new Error('无效执行记录');
    const row = Object.fromEntries([...EXECUTION_DIMENSIONS, 'provider'].map(k => [k, executionText(item[k], k === 'hostname' ? hostname : 'unknown')]));
    row.requestType = item.requestType ?? 'other';
    if (!['tool','non_tool','other'].includes(row.requestType)) throw new Error('无效执行请求类型');
    row.mode = item.mode ?? 'unknown';
    if (!EXECUTION_MODES.includes(row.mode)) throw new Error('无效执行模式');
    if (typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))) throw new Error('无效执行时间');
    row.timestamp = new Date(item.timestamp).toISOString();
    const parts = formatter.formatToParts(new Date(row.timestamp));
    const part = type => parts.find(p => p.type === type).value;
    row.date = part('year') + '-' + part('month') + '-' + part('day');
    for (const key of ['sessionHash','responseHash']) {
      if (typeof item[key] !== 'string' || !/^[a-f0-9]{16,64}$/.test(item[key])) throw new Error('执行记录只能保留哈希标识');
      row[key] = item[key];
    }
    for (const key of ['fullInputTokens','cacheReadTokens','outputTokens']) row[key] = item[key] == null ? null : executionCount(item[key]);
    if (row.fullInputTokens !== null && row.cacheReadTokens !== null && row.cacheReadTokens > row.fullInputTokens) throw new Error('缓存不能大于完整输入');
    for (const key of EXECUTION_COUNTS) row[key] = executionCount(item[key] ?? 0);
    if (!item.execHistogram || typeof item.execHistogram !== 'object' || Array.isArray(item.execHistogram)) throw new Error('缺少exec直方图');
    row.execHistogram = {};
    for (const [key,value] of Object.entries(item.execHistogram)) {
      if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error('无效exec直方图');
      executionCount(Number(key)); executionCount(value);
      executionCount(Number(key) * value);
      if (value) row.execHistogram[key] = value;
    }
    if (executionCount(histogramCount(row.execHistogram) + row.pendingExecs + row.unknownExecs) !== row.execCalls) throw new Error('exec统计不守恒');
    return row;
  });
}

// Same linear interpolation as daily quantiles, without expanding histogram samples.
function executionQuantile(histogram, total, p) {
  if (!total) return null;
  const index = (total - 1) * p;
  const valueAt = ordinal => {
    let count = 0;
    for (const [key,value] of Object.entries(histogram).sort((a,b) => Number(a[0])-Number(b[0]))) {
      count += value;
      if (ordinal < count) return Number(key);
    }
  };
  const low = valueAt(Math.floor(index)), high = valueAt(Math.ceil(index));
  return low + (high-low) * (index-Math.floor(index));
}

export function summarizeExecution(rows) {
  const out = { responseCount: rows.length, inputSamples: 0, averageInputTokens: null, peakInputTokens: null,
    cacheReadShare: null, histogram: {}, ...Object.fromEntries(EXECUTION_COUNTS.map(k => [k,0])) };
  let input = 0, cache = 0, cacheComplete = true;
  for (const row of rows) {
    for (const key of EXECUTION_COUNTS) out[key] = executionCount(out[key] + row[key]);
    for (const [key,value] of Object.entries(row.execHistogram)) out.histogram[key] = executionCount((out.histogram[key] || 0) + value);
    if (row.fullInputTokens !== null) {
      out.inputSamples++; input = executionCount(input + row.fullInputTokens);
      out.peakInputTokens = Math.max(out.peakInputTokens ?? 0, row.fullInputTokens);
    }
    if (row.fullInputTokens === null || row.cacheReadTokens === null) cacheComplete = false;
    else cache = executionCount(cache + row.cacheReadTokens);
  }
  out.completeExecs = histogramCount(out.histogram);
  out.innerToolCalls = Object.entries(out.histogram).reduce((sum,[key,n]) => executionCount(sum + Number(key)*n),0);
  const multi = Object.entries(out.histogram).reduce((sum,[key,n]) => sum + (Number(key)>=2 ? n : 0),0);
  out.meanTools = out.completeExecs ? out.innerToolCalls/out.completeExecs : null;
  out.medianTools = executionQuantile(out.histogram,out.completeExecs,.5);
  out.p75Tools = executionQuantile(out.histogram,out.completeExecs,.75);
  out.multiToolRate = out.completeExecs ? multi/out.completeExecs : null;
  out.singleToolRate = out.completeExecs ? (out.histogram[1] || 0)/out.completeExecs : null;
  out.zeroToolRate = out.completeExecs ? (out.histogram[0] || 0)/out.completeExecs : null;
  out.averageInputTokens = out.inputSamples ? input/out.inputSamples : null;
  out.cacheReadShare = cacheComplete && input ? cache/input : null;
  return out;
}

export function selectExecution(data, filters) {
  return (data.execution ?? []).filter(row => row.date >= filters.from && row.date <= filters.to
    && EXECUTION_DIMENSIONS.every(key => !filters[key] || row[key] === filters[key]));
}

export function groupExecution(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const name = typeof key === 'function' ? key(row) : row[key];
    if (!groups.has(name)) groups.set(name,[]);
    groups.get(name).push(row);
  }
  return [...groups].map(([name,items]) => ({ name,...summarizeExecution(items) }));
}

