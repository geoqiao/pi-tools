const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = value => value == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const money = value => value == null ? '未定价' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const full = value => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
const percent = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const labels = { inputTokens: '输入（含缓存写）', cachedInputTokens: '缓存读取', outputTokens: '输出', reasoningOutputTokens: '推理', totalTokens: 'Token（不含缓存）', allTokens: 'Token（含缓存）', estimatedCost: '完整日金额', knownCost: '已知金额小计' };
const shortLabels = ['输入 / 含缓存写', '缓存读取', '输出', '推理'];
const dimensions = { source: 'Harness', model: '模型', project: '项目', hostname: '终端', requestType: '请求类型' };
const colors = ['#3978ca', '#85aace', '#188c88', '#8972bc'];
const typeColors = ['#3978ca', '#188c88', '#b4bfce'];
const rangeLabels = ['Min', 'P25', 'P50', 'P75', 'P90', 'Max'];
const rangeValues = row => [row.min, ...row.values, row.max];
const dimensionValue = (key, value) => key === 'requestType' ? REQUEST_TYPES[value] ?? REQUEST_TYPES.other : value;
const executionModes = { code_mode: 'Code Mode 证据', other_tools: '其他工具', no_tools: '无工具', unknown: '未知' };
const executionCsvColumns = ['date', 'source', 'provider', 'model', 'project', 'hostname', 'requestType', 'timestamp', 'sessionHash', 'responseHash', 'mode', 'fullInputTokens', 'cacheReadTokens', 'outputTokens', 'outerToolCalls', 'execCalls', 'waitCalls', 'execHistogram', 'pendingExecs', 'unknownExecs', 'incompleteToolCalls', 'outerExecErrors', 'nestedToolErrors', 'shellNonzero'];
const icons = {
  dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  range: '<path d="M3 12h18M3 8v8m18-8v8"/><rect x="7" y="6" width="10" height="12"/><path d="M12 6v12"/>',
  compare: '<path d="M4 6h16m-4-4 4 4-4 4M20 18H4m4-4-4 4 4 4"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10m6-10v10"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  print: '<path d="M7 8V3h10v5M7 16H3V9h18v7h-4"/><path d="M7 13h10v8H7zM17 10h1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m6 0h5"/>',
  model: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5m-9 5v10"/>',
  folder: '<path d="M3 6h7l2 3h9v11H3V6Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-5 0h10"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v2c0 4-12 2-12 6"/>',
  trend: '<path d="M3 3v18h18M6 16l5-6 4 3 6-8"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  expand: '<path d="M14 3h7v7m0-7-8 8M10 21H3v-7m0 7 8-8"/>',
  left: '<path d="m14 5-7 7 7 7"/>', right: '<path d="m10 5 7 7-7 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.info}</svg>`;
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);
let pageIndex = 0, currentRows = [], currentExecutionRows = [], currentFilters, showAll = false, showAllExecutionSessions = false, currentDays = [], calendar = [], activeView = 'overview';
for (const row of DATA.buckets) row.requestType ??= 'other';
const executionData = Array.isArray(DATA.execution) ? DATA.execution : [];
const usedModels = [...new Set(DATA.buckets.map(row => row.model))].sort();
const help = {
  trend: '每根柱表示一天，点击或按 Enter / 空格筛选。四类 Token 互斥堆叠；金额模式仅显示已知小计。灰色底标为无记录，不能断言未使用；黄色底标为未完整定价。截止日可能尚未结束。',
  request: '占比按含缓存 Token 计算，不是请求次数。整次请求归入非工具、含工具、其他三类之一，合计等于总量，不逐工具分摊。文字与工具混合仍归含工具。已接入 Pi / OMP、Claude、Codex、ZCode、Kimi 的可靠响应证据；缺边界、累计回退或关联冲突等保留为其他，不等于非工具。',
  quantile: 'Min / P25 / P50 / P75 / P90 / Max 使用同一样本，分位采用线性插值。默认只纳入有用量日；将无记录日按 0 纳入是计算假设。小样本仅描述已有记录，不代表稳定规律；极值不是预算或预测边界。',
  cost: '完整日金额分布排除未完整定价日期，可能造成样本偏差，不代表全部使用日。已知小计分布另列，不冒充完整日金额。可计价 Token 覆盖率不是账单覆盖率。',
  simulation: '固定当前筛选每天的输入（含缓存写）、缓存读取、输出、推理数量，分别按本报告用过的模型费率逐日计价，再求 Min / 分位 / Max。原模型未定价不影响目标模型计价；目标费率不足或无样本不显示 0。假设 Token 数不随模型变化，不是实际节省或质量预测。',
  details: '当前 CSV 与页面相同，按日期 × Harness × 模型 × 项目 × 终端 × 请求类型聚合。knownCost 是已知小计，estimatedCost 仅在完整定价时有值，coverage 按含缓存 Token 计算。同目录 details.csv / usage.json 仍是原始粒度。',
  execution: '执行视图只统计原生 Pi assistant 响应中的 exec / wait 证据。已记录响应不等于完整 HTTP/API 请求或计费次数；其他 Harness、旧导入和缺失 execution 数据没有证据，不显示为零。精确直方图排除 pending / unknown；不完整工具、嵌套错误和 shell 非零数是 trace 观察下限，不推断成功率或失败率。',
  'execution-trend': '趋势按日期合并执行响应。工具数均值、中位数和 P75 只使用已完成且可核对的精确 exec 样本；pending / unknown 不按零处理。点击日期会复用全局日期筛选。',
};
function table(headers, rows) {
  if (!rows.length) return '<p class="empty">没有可用数据，请调整筛选。</p>';
  return `<table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function costText(row) {
  if (!row.allTokens) return '无用量';
  if (!row.pricedTokens) return '未定价';
  return `${money(row.knownCost)}${row.unpricedRows ? ' · 已知小计' : ''}`;
}
function getFilters() { return Object.fromEntries(['from', 'to', ...DIMENSIONS].map(key => [key, $(key).value])); }
function query() { pageIndex = 0; showAll = false; showAllExecutionSessions = false; render(); }
function openInfo(topic) {
  $('help-message').hidden = !help[topic]; $('help-message').textContent = help[topic] ?? '';
  $('information').showModal(); $('information').scrollTop = 0;
}
function switchView(view) {
  if (!['overview', 'percentiles', 'simulation', 'records', 'execution'].includes(view)) return;
  activeView = view;
  for (const node of document.querySelectorAll('.view')) node.hidden = node.id !== view;
  for (const button of document.querySelectorAll('.views [data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  // Replace rather than push: exploration does not flood the browser's back stack.
  history.replaceState(null, '', `#${view}`);
  if (view === 'overview' && calendar.length) renderTrend(calendar);
  if (view === 'execution' && currentExecutionRows.length) renderExecutionTrend(currentExecutionRows);
}
$('from').value = DATA.from; $('to').value = DATA.to;
for (const key of ['from', 'to']) { $(key).min = DATA.from; $(key).max = DATA.to; }
for (const key of DIMENSIONS) {
  const sourceRows = [...DATA.buckets, ...executionData];
  const values = key === 'requestType' ? Object.keys(REQUEST_TYPES) : [...new Set(sourceRows.map(row => row[key]).filter(value => value != null))].sort();
  for (const value of values) $(key).add(new Option(dimensionValue(key, value), value));
}
const generated = new Date(DATA.generatedAt).toLocaleString('zh-CN', { timeZone: DATA.timeZone });
$('metadata').textContent = `${DATA.from} — ${DATA.to} · ${DATA.timeZone} · 数据快照 ${generated} · 价格快照 ${DATA.priceSnapshot.date} · 本地覆盖 ${DATA.priceSnapshot.overrideCount} 项`;
$('footer-meta').textContent = `${DATA.timeZone} · ${generated}`;
const incomplete = DATA.statuses.filter(s => ['partial', 'error'].includes(s.state) || s.warningCount > 0);
$('snapshot-label').textContent = incomplete.length ? `${incomplete.length} 个来源需注意` : '本地快照';
$('snapshot').classList.toggle('has-warning', incomplete.length > 0);
if (incomplete.length) {
  $('warnings').hidden = false;
  $('warnings').textContent = `${incomplete.map(s => s.source).join('、')} 存在读取失败、未完成索引或警告。数据可能不完整；无记录不代表未使用。`;
}
$('source-status').innerHTML = table(['Harness', '状态', '原始记录（全历史）', '会话（全历史）', '说明'], DATA.statuses.map(s => [s.source, ({ ok: '已读取', empty: '无记录', partial: '部分数据', error: '读取失败' })[s.state] ?? s.state, s.buckets, s.sessions, s.note]));
$('price-table').innerHTML = table(['模型', '输入 $/M', '缓存读 $/M', '输出 $/M', '推理 $/M', '提供方', '出处', '备注'], usedModels.map(model => {
  const r = findRate(model, DATA.prices);
  return [model, r?.input, r?.cacheRead, r?.output, r?.reasoning, r?.provider ?? '未识别', r?.reference ?? '请添加本地覆盖', r?.tiered ? '仅基础档；上下文阶梯未展开' : '基础费率'];
}));

function renderTrend(days) {
  const field = $('trend-metric').value, cost = field === 'cost', stacked = cost || field === 'tokens';
  const keys = cost ? ['inputCost', 'cacheCost', 'outputCost', 'reasoningCost'] : field === 'tokens' ? TOKEN_FIELDS : [field];
  const total = day => cost ? day.knownCost : field === 'tokens' ? day.allTokens : day[field];
  const width = Math.max(300, $('trend').clientWidth), height = 208, left = 54, top = 12, plotH = 165, plotW = width - left - 14;
  const maximum = Math.max(1, ...days.map(total)), step = plotW / Math.max(1, days.length);
  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="每日${cost ? '已知估算金额' : 'Token'}，点击或键盘选择日期">`;
  for (let i = 0; i <= 3; i++) {
    const y = top + plotH * i / 3;
    svg += `<line class="gridline" x1="${left}" x2="${width - 14}" y1="${y}" y2="${y}"/><text x="${left - 8}" y="${y + 3}" text-anchor="end">${esc(num(maximum * (1 - i / 3)))}</text>`;
  }
  const tickCount = Math.min(days.length, Math.max(2, Math.min(7, Math.floor(plotW / 70))));
  const ticks = new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (days.length - 1) / Math.max(1, tickCount - 1))));
  days.forEach((day, i) => {
    const title = `${day.name} · ${!day.recorded ? '无记录' : cost ? costText(day) : `${full(total(day))} Token`}\n${TOKEN_FIELDS.map(key => `${labels[key]} ${full(day[key])}`).join(' · ')}`;
    const x = left + i * step + 0.5, w = Math.max(0.2, step - 1);
    svg += `<g role="button" tabindex="0" data-date="${day.name}" aria-label="${esc(title)}，筛选此日"><title>${esc(title)}</title><rect class="hit" x="${x}" y="${top}" width="${w}" height="${plotH}" fill="transparent"/>`;
    let y = top + plotH;
    for (const [j, key] of keys.entries()) {
      const h = day[key] / maximum * plotH; y -= h;
      svg += `<rect pointer-events="none" x="${x}" y="${y}" width="${w}" height="${h}" fill="${colors[stacked ? j : TOKEN_FIELDS.indexOf(field)]}"/>`;
    }
    if (!day.recorded || (cost && day.unpricedRows)) svg += `<rect x="${x}" y="${top + plotH + 3}" width="${w}" height="3" fill="${day.recorded ? '#b57826' : '#b4bfce'}"/>`;
    svg += '</g>';
    if (ticks.has(i)) svg += `<text x="${x}" y="202" text-anchor="${i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}">${day.name.slice(5)}</text>`;
  });
  $('trend').innerHTML = svg + '</svg>';
  $('trend-legend').innerHTML = (stacked ? TOKEN_FIELDS : [field]).map(key => `<span><i style="background:${colors[TOKEN_FIELDS.indexOf(key)]}"></i>${esc(labels[key])}${cost ? '金额' : ''}</span>`).join('');
  $('daily-table').innerHTML = `<table><thead><tr><th>日期</th><th>Token（含缓存）</th><th>已知估算金额</th><th>可计价 Token</th></tr></thead><tbody>${days.map(day => `<tr><td><button data-date="${day.name}">${day.name}</button></td><td>${day.recorded ? full(day.allTokens) : '无记录'}</td><td>${esc(day.recorded ? costText(day) : '无记录')}</td><td>${percent(day.coverage)}</td></tr>`).join('')}</tbody></table>`;
}
function rankMarkup(groups, key, field, limit) {
  const cost = field === 'knownCost', maximum = Math.max(1, ...groups.map(row => row[field])), total = groups.reduce((n, row) => n + row[field], 0);
  return groups.slice(0, limit).map(row => {
    const label = dimensionValue(key, row.name), title = `${label}\n${labels[field]}：${full(row[field])}\n估算：${costText(row)} · 可计价 Token ${percent(row.coverage)}\n点击筛选`;
    const segments = field === 'allTokens' ? TOKEN_FIELDS.map((k, i) => `<span style="width:${row[k] / maximum * 100}%;background:${colors[i]}"></span>`).join('') : `<span style="width:${row[field] / maximum * 100}%;background:${colors[TOKEN_FIELDS.indexOf(field)] ?? colors[0]}"></span>`;
    return `<button class="rank-row" data-dimension="${key}" data-value="${esc(row.name)}" title="${esc(title)}" aria-label="筛选${dimensions[key]}：${esc(label)}；${cost ? esc(costText(row)) : `${full(row[field])} Token`}"><span class="rank-labels"><span class="rank-name">${esc(label)}</span><span class="rank-value number">${esc(cost ? costText(row) : num(row[field]))}</span><span class="rank-share number">${cost && !row.pricedTokens ? '—' : total ? percent(row[field] / total) : '—'}</span></span><span class="rank-track" aria-hidden="true">${segments}</span></button>`;
  }).join('') || '<p class="empty">没有可用数据</p>';
}
function renderDistributions(rows) {
  const key = $('distribution-dimension').value, field = $('distribution-metric').value;
  const groups = groupRows(rows, key).sort((a, b) => b[field] - a[field] || a.name.localeCompare(b.name));
  $('distributions').innerHTML = rankMarkup(groups, key, field, showAll ? groups.length : 5);
  $('ranking-note').textContent = `${showAll ? groups.length : Math.min(5, groups.length)} / ${groups.length} 项${field === 'knownCost' ? ' · 占已知小计' : ' · 点击下钻'}`;
  $('show-all').hidden = groups.length <= 5;
  $('show-all').textContent = showAll ? '前 5 项' : `全部 ${groups.length} 项`;
  $('show-all').setAttribute('aria-expanded', String(showAll));
  const harness = groupRows(rows, 'source').sort((a, b) => b.allTokens - a.allTokens);
  $('harness-ranking').innerHTML = rankMarkup(harness, 'source', 'allTokens', harness.length);
  $('harness-count').textContent = `${harness.length} 项`;
}
function renderRequests(rows, sum, filters) {
  const groups = groupRows(rows, 'requestType');
  const values = Object.keys(REQUEST_TYPES).map(key => groups.find(r => r.name === key)?.allTokens ?? 0);
  const classified = sum.allTokens ? (values[0] + values[1]) / sum.allTokens : null;
  let offset = 0;
  const arcs = values.map((value, i) => {
    const part = sum.allTokens ? value / sum.allTokens * 100 : 0;
    const arc = `<circle cx="70" cy="70" r="55" fill="none" stroke="${typeColors[i]}" stroke-width="12" pathLength="100" stroke-dasharray="${part} ${100 - part}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"/>`;
    offset += part; return arc;
  }).join('');
  $('request-ring').innerHTML = `<svg viewBox="0 0 140 140" role="img" aria-label="可分类 Token ${percent(classified)}，不是请求次数"><circle cx="70" cy="70" r="55" fill="none" stroke="#edf1f6" stroke-width="12"/>${arcs}<text x="70" y="70" text-anchor="middle" class="ring-center">${percent(classified)}</text><text x="70" y="89" text-anchor="middle" class="ring-caption">可分类 Token</text></svg>`;
  const short = ['非工具调用', '含工具调用', '其他 / 未判定'];
  $('request-summary').innerHTML = Object.entries(REQUEST_TYPES).map(([value, label], i) => `<button data-request-type="${value}" aria-pressed="${filters.requestType === value}" aria-label="${label}，${full(values[i])} Token，点击切换筛选" title="${label} · ${full(values[i])} Token"><span class="request-label"><i style="background:${typeColors[i]}"></i>${short[i]}</span><strong>${sum.allTokens ? percent(values[i] / sum.allTokens) : '—'}</strong><span class="request-track" aria-hidden="true"><span style="width:${sum.allTokens ? values[i] / sum.allTokens * 100 : 0}%;background:${typeColors[i]}"></span></span></button>`).join('');
  $('classification-note').textContent = '含缓存 Token 占比 · 非请求次数';
}
function rangeChart(row, maximum = row.max, formatter = num) {
  if (row.min == null) return '<div class="range-empty">无可用样本</div>';
  const scale = value => 10 + value / Math.max(maximum, 1e-9) * 280;
  const [min, p25, p50, p75, p90, max] = rangeValues(row).map(scale);
  const title = rangeValues(row).map((v, i) => `${rangeLabels[i]} ${formatter(v)}`).join(' · ');
  return `<svg class="range-chart" viewBox="0 0 300 36" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><path class="range-line" d="M${min} 18H${max}M${min} 13v10M${max} 13v10"/><rect class="range-box" x="${p25}" y="11" width="${Math.max(.5, p75 - p25)}" height="14" rx="2"/><circle class="range-median" cx="${p50}" cy="18" r=".1"/><path class="range-p90" d="m${p90} 14 4 4-4 4-4-4Z"/></svg>`;
}
function sixStats(row, formatter = num) {
  return rangeValues(row).map((value, i) => `<div title="${rangeLabels[i]}：${full(value)}"><span>${rangeLabels[i]}</span><strong class="${i === 2 ? 'median' : ''}">${esc(formatter(value))}</strong></div>`).join('');
}
function renderHistogram(days) {
  if (!days.length) { $('daily-histogram').innerHTML = '<svg class="chart" viewBox="0 0 300 68" role="img" aria-label="无样本日"><line class="gridline" x1="0" x2="300" y1="45" y2="45"/></svg>'; return; }
  const values = days.map(d => d.allTokens), max = Math.max(1, ...values), bins = Array(16).fill(0);
  for (const value of values) bins[Math.min(15, Math.floor(value / max * 16))]++;
  const peak = Math.max(1, ...bins);
  $('daily-histogram').innerHTML = `<svg class="chart" viewBox="0 0 300 68" role="img" aria-label="每日含缓存 Token 频数分布，横轴用量，纵轴天数">${bins.map((count, i) => `<rect x="${i * 18.75 + 1}" y="${45 - count / peak * 40}" width="16" height="${count / peak * 40}" fill="#85aace"><title>${num(i / 16 * max)}–${num((i + 1) / 16 * max)} Token：${count} 天</title></rect>`).join('')}<text x="0" y="64">0</text><text x="150" y="64" text-anchor="middle">Token / 日 · 频数</text><text x="300" y="64" text-anchor="end">${num(max)}</text></svg>`;
}
function renderPercentiles(days) {
  const quantiles = percentileRows(days), tokenRows = quantiles.filter(row => row.metric !== 'estimatedCost');
  const all = tokenRows.find(row => row.metric === 'allTokens');
  $('daily-median').textContent = num(all.values[1]);
  $('daily-sample').textContent = `${days.length} 样本日${$('include-zero').checked ? ' · 含假设零日' : ''}`;
  $('daily-range').innerHTML = rangeChart(all);
  $('daily-stats').innerHTML = sixStats(all);
  renderHistogram(days);
  $('sample-note').textContent = `${$('include-zero').checked ? '日历日 · 无记录假设为 0' : '仅有用量日'} · ${days.length} 个样本${days.length < 7 ? ' · 小样本' : ''}`;
  $('quantile-charts').innerHTML = tokenRows.map(row => `<div class="quantile-row"><div class="quantile-title"><span>${labels[row.metric]}</span><span>${row.sampleDays} 天</span></div>${rangeChart(row)}<div class="six-stats">${sixStats(row)}</div></div>`).join('');
  const headings = ['指标', '样本日', ...rangeLabels];
  $('quantiles').innerHTML = table(headings, tokenRows.map(row => [labels[row.metric], row.sampleDays, ...rangeValues(row).map(full)]));
  const complete = quantiles.find(row => row.metric === 'estimatedCost'), excluded = days.length - complete.sampleDays;
  $('cost-sample-note').textContent = `完整定价 ${complete.sampleDays} / ${days.length} 天 · 排除 ${excluded} 天。${excluded ? '排除日期可能造成样本偏差，不代表全部使用日。' : '公开费率估算，非实际账单。'}`;
  $('cost-range').innerHTML = rangeChart(complete, complete.max, money);
  $('cost-stats').innerHTML = sixStats(complete, value => value == null ? '—' : num(value));
  $('cost-quantiles').innerHTML = table(headings, [
    ['完整日金额（USD）', complete.sampleDays, ...rangeValues(complete).map(v => v == null ? '无完整定价样本' : money(v))],
    ['已知小计（非完整金额）', days.length, ...[0, ...QUANTILES, 1].map(p => days.some(d => d.pricedTokens > 0) ? money(quantile(days.map(d => d.knownCost), p)) : '无可计价用量')],
  ]);
}
function renderSimulations() {
  const sort = $('simulation-sort').value, value = row => sort === 'p50' ? row.values[1] : sort === 'p90' ? row.values[3] : row[sort];
  const rows = simulateModels(currentDays, usedModels, DATA.prices).sort((a, b) => (value(a) ?? Infinity) - (value(b) ?? Infinity) || a.model.localeCompare(b.model));
  const maximum = Math.max(1e-9, ...rows.map(row => row.max ?? 0));
  $('simulation-sample').textContent = `${currentDays.length} 样本日 · ${$('include-zero').checked ? '含假设零日' : '仅有用量日'} ↗`;
  $('simulation-note').textContent = `${rows.filter(r => r.min != null).length} / ${rows.length} 个模型可计价 · 统一线性刻度`;
  $('simulations').innerHTML = `<table><thead><tr>${['目标模型', '日金额区间', '样本日', ...rangeLabels].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.model)}</td><td>${row.min == null ? `<span class="unavailable">${currentDays.length ? '目标费率不足' : '无样本'}</span>` : rangeChart(row, maximum, money)}</td><td>${row.sampleDays}</td>${rangeValues(row).map(v => `<td title="${esc(v == null ? '不可计价' : `${full(v)} USD`)}">${v == null ? '—' : money(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderDetails() {
  const sorted = [...currentRows].sort((a, b) => $('sort').value === 'cost' ? (b.pricedTokens ? b.knownCost : -1) - (a.pricedTokens ? a.knownCost : -1) : $('sort').value === 'tokens' ? b.allTokens - a.allTokens : b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(sorted.length / 50)); pageIndex = Math.min(pageIndex, pages - 1);
  $('details').innerHTML = table(['日期', 'Harness', '模型', '项目', '终端', '请求类型', '输入（含缓存写）', '缓存读', '输出', '推理', 'Token（含缓存）', 'Token（不含缓存）', '已知估算金额', '可计价 Token'], sorted.slice(pageIndex * 50, (pageIndex + 1) * 50).map(row => [row.date, ...DIMENSIONS.map(key => dimensionValue(key, row[key])), ...TOKEN_FIELDS.map(key => full(row[key])), full(row.allTokens), full(row.totalTokens), costText(row), percent(row.coverage)]));
  $('page-status').textContent = `${pageIndex + 1} / ${pages} · ${full(sorted.length)} 条`;
  $('previous').disabled = pageIndex === 0; $('next').disabled = pageIndex >= pages - 1;
}
function executionTable(headers, rows) {
  if (!rows.length) return '<p class="empty">没有可用的执行证据。</p>';
  return `<table class="execution-modes-table"><thead><tr>${headers.map(header => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function executionMetricValue(value) { return value == null ? '—' : num(value); }
function executionTrendValue(group, metric) {
  if (metric === 'responseCount') return group.responseCount;
  if (metric === 'exactCoverage') return group.execCalls ? group.completeExecs / group.execCalls : null;
  return group[metric];
}
function executionTrendLabel(metric, value) {
  if (value == null) return '无精确样本';
  if (metric === 'exactCoverage') return percent(value);
  if (metric === 'responseCount') return `${full(value)} 响应`;
  return `${full(value)} 个工具`;
}
function renderExecutionHistogram(sum) {
  const histogram = sum.histogram ?? {};
  const rawBins = [0, 1, 2, 3, 4].map(value => histogram[String(value)] ?? histogram[value] ?? 0);
  rawBins.push(Object.entries(histogram).reduce((total, [value, count]) => total + (Number(value) >= 5 ? count : 0), 0));
  const labelsForBins = ['0', '1', '2', '3', '4', '5+'], peak = Math.max(1, ...rawBins);
  const bars = rawBins.map((count, index) => `<div class="execution-bin" title="${esc(`${labelsForBins[index]} 个内部工具：${count} 个精确样本`)}"><span class="execution-bin-value">${full(count)}</span><span class="execution-bin-bar-wrap"><span class="execution-bin-bar" style="height:${count ? count / peak * 100 : 0}%"></span></span><span class="execution-bin-label">${labelsForBins[index]}</span></div>`).join('');
  $('execution-histogram').innerHTML = `<div class="execution-bars" role="img" aria-label="精确 exec 内部工具数分布；${labelsForBins.map((label, index) => `${label} 个工具 ${rawBins[index]} 个样本`).join('，')}">${bars}</div>`;
  $('execution-histogram-sample').textContent = `${full(sum.completeExecs)} 个精确样本`;
  $('execution-histogram-note').innerHTML = `<span>0 / 1 / 2 / 3 / 4 / 5+ 由未分箱直方图合并。</span><span>pending ${full(sum.pendingExecs)} · unknown ${full(sum.unknownExecs)} 不入分布。</span>`;
}
function renderExecutionTrend(rows) {
  const groups = groupExecution(rows, 'date').sort((a, b) => a.name.localeCompare(b.name));
  const metric = $('execution-trend-metric').value;
  const values = groups.map(group => executionTrendValue(group, metric));
  const numeric = values.map(value => value ?? 0), maximum = metric === 'exactCoverage' ? 1 : Math.max(1, ...numeric);
  const width = Math.max(300, $('execution-trend').clientWidth), height = 210, left = 52, top = 12, plotH = 160, plotW = width - left - 14, step = plotW / Math.max(1, groups.length);
  const valueText = value => metric === 'exactCoverage' ? percent(value) : num(value);
  let svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="执行效率每日趋势，${esc($('execution-trend-metric').selectedOptions[0].textContent)}">`;
  for (let i = 0; i <= 3; i++) {
    const y = top + plotH * i / 3, tick = maximum * (1 - i / 3);
    svg += `<line class="gridline" x1="${left}" x2="${width - 14}" y1="${y}" y2="${y}"/><text x="${left - 8}" y="${y + 3}" text-anchor="end">${esc(valueText(tick))}</text>`;
  }
  const tickCount = Math.min(groups.length, Math.max(2, Math.min(8, Math.floor(plotW / 70))));
  const ticks = new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (groups.length - 1) / Math.max(1, tickCount - 1))));
  groups.forEach((group, index) => {
    const value = values[index], x = left + index * step + 0.5, w = Math.max(.2, step - 1), barHeight = value == null ? 0 : value / maximum * plotH;
    const title = `${group.name} · ${executionTrendLabel(metric, value)} · ${full(group.responseCount)} 已记录 assistant 响应 · 完整 exec ${full(group.completeExecs)} / ${full(group.execCalls)}`;
    svg += `<g role="button" tabindex="0" data-date="${esc(group.name)}" aria-label="${esc(title)}，筛选此日"><title>${esc(title)}</title><rect class="hit" x="${x}" y="${top}" width="${w}" height="${plotH}" fill="transparent"/><rect pointer-events="none" x="${x}" y="${top + plotH - barHeight}" width="${w}" height="${barHeight}" fill="${value == null ? '#b4bfce' : '#3978ca'}"/>${value == null ? `<rect class="execution-missing-mark" pointer-events="none" x="${x}" y="${top + plotH - 5}" width="${w}" height="5"/>` : ''}`;
    if (ticks.has(index)) svg += `<text x="${x}" y="202" text-anchor="${index === 0 ? 'start' : index === groups.length - 1 ? 'end' : 'middle'}">${group.name.slice(5)}</text>`;
    svg += '</g>';
  });
  $('execution-trend').innerHTML = svg + '</svg>';
  $('execution-trend-legend').innerHTML = `<span><i style="background:#3978ca"></i>${esc($('execution-trend-metric').selectedOptions[0].textContent)}</span><span>灰色 = 无精确样本</span>`;
  $('execution-trend-sample').textContent = `${groups.length} 天 · ${full(rows.length)} 条响应`;
}
function renderExecutionModes(rows) {
  const groups = groupExecution(rows, 'mode').sort((a, b) => b.responseCount - a.responseCount || a.name.localeCompare(b.name));
  $('execution-modes').innerHTML = executionTable(['证据模式', '已记录响应', 'exec 调用', '完整样本', '均值工具', 'P50 工具', 'pending', 'unknown'], groups.map(group => [executionModes[group.name] ?? group.name, full(group.responseCount), full(group.execCalls), full(group.completeExecs), executionMetricValue(group.meanTools), executionMetricValue(group.medianTools), full(group.pendingExecs), full(group.unknownExecs)]));
}
function renderExecutionEvidence(sum) {
  const stats = [
    ['外层工具调用', sum.outerToolCalls, 'assistant 响应中的工具调用'],
    ['wait 调用', sum.waitCalls, '等待执行结果的调用'],
    ['精确内部工具总数', sum.innerToolCalls, '完整 exec 样本加权总和'],
    ['不完整工具下限', sum.incompleteToolCalls, '仅已观察到的下限'],
    ['pending exec', sum.pendingExecs, '不进入精确分母'],
    ['unknown exec', sum.unknownExecs, '不进入精确分母'],
    ['缓存读 / 完整输入', percent(sum.cacheReadShare), '缺任一输入字段则为 —'],
    ['错误标记（观察下限）', sum.outerExecErrors + sum.nestedToolErrors + sum.shellNonzero, `外层 ${sum.outerExecErrors} · 嵌套 ${sum.nestedToolErrors} · shell 非零 ${sum.shellNonzero}`],
  ];
  $('execution-evidence').innerHTML = stats.map(([label, value, note]) => {
    const warning = ['不完整工具下限', 'pending exec', 'unknown exec', '错误标记（观察下限）'].includes(label) && Number(value) > 0;
    return `<div class="execution-stat${warning ? ' warn' : ''}"><span>${esc(label)}</span><strong>${esc(typeof value === 'string' ? value : full(value))}</strong><small>${esc(note)}</small></div>`;
  }).join('');
}
function renderExecutionTables(rows) {
  const models = groupExecution(rows, 'model').sort((a, b) => b.responseCount - a.responseCount || a.name.localeCompare(b.name));
  $('execution-model-table').innerHTML = executionTable(['模型', '已记录响应', 'exec 调用', '完整样本', 'P50 工具', '均值工具', 'P75 工具', '平均输入', 'pending', 'unknown'], models.map(group => [group.name, full(group.responseCount), full(group.execCalls), full(group.completeExecs), executionMetricValue(group.medianTools), executionMetricValue(group.meanTools), executionMetricValue(group.p75Tools), executionMetricValue(group.averageInputTokens), full(group.pendingExecs), full(group.unknownExecs)]));
  const sessions = groupExecution(rows, 'sessionHash').sort((a, b) => b.responseCount - a.responseCount || a.name.localeCompare(b.name));
  const sessionModels = new Map();
  for (const row of rows) {
    if (!sessionModels.has(row.sessionHash)) sessionModels.set(row.sessionHash, new Set());
    sessionModels.get(row.sessionHash).add(row.model);
  }
  const visibleSessions = showAllExecutionSessions ? sessions : sessions.slice(0, 20);
  $('execution-session-table').innerHTML = executionTable(['会话', '模型', '已记录响应', 'exec 调用', '完整样本', 'P50 工具', '均值工具', '平均输入'], visibleSessions.map(group => [`会话 ${String(group.name).slice(0, 8)}`, [...(sessionModels.get(group.name) ?? [])].join('、'), full(group.responseCount), full(group.execCalls), full(group.completeExecs), executionMetricValue(group.medianTools), executionMetricValue(group.meanTools), executionMetricValue(group.averageInputTokens)]));
  const sessionToggle = $('execution-session-toggle');
  sessionToggle.hidden = sessions.length <= 20;
  sessionToggle.textContent = showAllExecutionSessions ? `收起（${full(sessions.length)} 个）` : `显示全部 ${full(sessions.length)} 个会话`;
  sessionToggle.setAttribute('aria-expanded', String(showAllExecutionSessions));
}
function renderExecution(rows) {
  const summary = summarizeExecution(rows);
  currentExecutionRows = rows;
  $('execution-empty').hidden = rows.length > 0;
  $('execution-data').hidden = rows.length === 0;
  $('execution-export').disabled = rows.length === 0;
  $('execution-scope').textContent = rows.length ? `${full(summary.responseCount)} 条已记录响应` : '无执行证据';
  if (!rows.length) return;
  $('execution-batch-value').textContent = percent(summary.multiToolRate);
  $('execution-batch-value').title = `多工具精确 exec 样本 / 完整 exec 样本；${percent(summary.multiToolRate)}`;
  const multiToolSamples = Object.entries(summary.histogram ?? {}).reduce((total, [value, count]) => total + (Number(value) >= 2 ? count : 0), 0);
  $('execution-batch-note').textContent = `${full(multiToolSamples)} / ${full(summary.completeExecs)} 个精确样本 ≥2 工具`;
  $('execution-median-value').textContent = executionMetricValue(summary.medianTools);
  $('execution-median-note').textContent = summary.completeExecs ? `${full(summary.completeExecs)} 个精确样本` : '无精确样本，不按 0 计';
  $('execution-mean-value').textContent = executionMetricValue(summary.meanTools);
  $('execution-mean-note').textContent = summary.completeExecs ? `P75 ${executionMetricValue(summary.p75Tools)} · ${full(summary.completeExecs)} 个精确样本` : '无精确样本，不按 0 计';
  $('execution-response-value').textContent = full(summary.responseCount);
  $('execution-response-value').title = '已记录 assistant 响应；不等于完整 HTTP/API 请求或计费次数';
  $('execution-input-value').textContent = executionMetricValue(summary.averageInputTokens);
  $('execution-input-note').textContent = summary.inputSamples ? `${full(summary.inputSamples)} / ${full(summary.responseCount)} 个响应有完整输入 · 峰值 ${executionMetricValue(summary.peakInputTokens)}` : '没有完整输入样本，不按 0 计';
  $('execution-exact-value').textContent = percent(summary.execCalls ? summary.completeExecs / summary.execCalls : null);
  $('execution-exact-note').textContent = `${full(summary.completeExecs)} 完整 · ${full(summary.pendingExecs)} pending · ${full(summary.unknownExecs)} unknown`;
  renderExecutionHistogram(summary); renderExecutionTrend(rows); renderExecutionModes(rows); renderExecutionEvidence(summary); renderExecutionTables(rows);
}
function render() {
  const filters = getFilters();
  const valid = filters.from && filters.to && filters.from <= filters.to && filters.from >= DATA.from && filters.to <= DATA.to;
  for (const id of ['from', 'to']) $(id).setAttribute('aria-invalid', String(!valid));
  if (!valid) {
    $('filter-status').textContent = `请选择 ${DATA.from} 至 ${DATA.to} 内有效日期；保留上次有效结果。`;
    $('export').disabled = true; $('execution-export').disabled = true;
    return;
  }
  $('export').disabled = false;
  currentFilters = filters;
  const { buckets } = selectData(DATA, filters);
  const selectedExecution = selectExecution(DATA, filters);
  currentRows = detailRows(buckets);
  const sum = summarize(buckets), calendarDays = dailyRows(buckets, filters.from, filters.to, true), activeDays = calendarDays.filter(day => day.allTokens > 0);
  calendar = calendarDays;
  currentDays = $('include-zero').checked ? calendarDays : activeDays;
  $('filter-status').textContent = `${filters.from} — ${filters.to} · ${activeDays.length} / ${calendarDays.length} 天有用量 · ${full(currentRows.length)} 条日明细`;
  $('activity-count').textContent = `${activeDays.length} / ${calendarDays.length} 天有用量`;
  $('empty-state').hidden = sum.allTokens > 0;
  $('empty-state').textContent = selectedExecution.length ? '当前筛选没有 Token 用量记录；执行效率视图仍可查看原生 Pi assistant 响应证据。' : '当前筛选没有用量记录。调整筛选或重置即可继续。';
  $('breadcrumbs').innerHTML = (filters.from !== DATA.from || filters.to !== DATA.to ? `<button data-clear="dates" aria-label="移除日期筛选">${filters.from} — ${filters.to}${icon('close')}</button>` : '') + DIMENSIONS.filter(key => filters[key]).map(key => `<button data-clear="${key}" title="${esc(dimensionValue(key, filters[key]))}" aria-label="移除${dimensions[key]}筛选：${esc(dimensionValue(key, filters[key]))}"><span class="chip-name">${dimensions[key]}：${esc(dimensionValue(key, filters[key]))}</span>${icon('close')}</button>`).join('');
  if ($('breadcrumbs').childElementCount) $('breadcrumbs').insertAdjacentHTML('beforeend', '<button data-clear="all">清除全部</button>');
  for (const button of document.querySelectorAll('[data-days]')) {
    const from = button.dataset.days === 'all' ? DATA.from : [DATA.from, shiftDate(DATA.to, 1 - Number(button.dataset.days))].sort().at(-1);
    button.setAttribute('aria-pressed', String(filters.from === from && filters.to === DATA.to && (button.dataset.days === 'all' || from !== DATA.from)));
  }
  $('total-value').textContent = num(sum.allTokens); $('total-value').title = `${full(sum.allTokens)} Token（含缓存）`;
  $('total-value').dataset.value = String(sum.allTokens);
  $('net-value').textContent = `${num(sum.totalTokens)} 不含缓存`; $('net-value').title = `${full(sum.totalTokens)} Token（不含缓存）`;
  $('token-ribbon').innerHTML = TOKEN_FIELDS.map((key, i) => `<span style="width:${sum.allTokens ? sum[key] / sum.allTokens * 100 : 0}%;background:${colors[i]}"></span>`).join('');
  $('composition').innerHTML = TOKEN_FIELDS.map((key, i) => `<div class="token-part"><span><i style="background:${colors[i]}"></i>${shortLabels[i]}</span><strong class="number" title="${full(sum[key])} Token">${num(sum[key])}</strong><small>${sum.allTokens ? percent(sum[key] / sum.allTokens) : '—'}</small></div>`).join('');
  $('cost-label').textContent = sum.unpricedRows ? '估算已知小计 · USD' : '估算 · USD';
  $('cost-value').textContent = !sum.allTokens ? '—' : !sum.pricedTokens ? '未定价' : money(sum.knownCost);
  $('cost-value').title = `${costText(sum)}；不是实际扣款`;
  $('coverage-bar').style.width = `${(sum.coverage ?? 0) * 100}%`;
  $('coverage-value').textContent = `${percent(sum.coverage)} Token 可计价`;
  const unpriced = groupRows(buckets, 'model').filter(row => row.unpricedRows);
  $('unpriced').hidden = !unpriced.length;
  $('unpriced-models').innerHTML = table(['模型', '未定价 Token', '已知估算金额', '可计价 Token'], unpriced.map(row => [row.name, full(row.allTokens - row.pricedTokens), costText(row), percent(row.coverage)]));
  renderDistributions(buckets); renderRequests(buckets, sum, filters); renderTrend(calendarDays); renderPercentiles(currentDays); renderSimulations(); renderDetails(); renderExecution(selectedExecution);
}
for (const id of ['from', 'to', ...DIMENSIONS, 'include-zero', 'trend-metric', 'distribution-metric', 'distribution-dimension', 'execution-trend-metric']) $(id).addEventListener('change', query);
$('show-all').addEventListener('click', () => { showAll = !showAll; render(); });
for (const id of ['distributions', 'harness-ranking']) $(id).addEventListener('click', event => {
  const button = event.target.closest('[data-dimension]');
  if (button) { $(button.dataset.dimension).value = button.dataset.value; query(); $(button.dataset.dimension).focus(); }
});
$('breadcrumbs').addEventListener('click', event => {
  const button = event.target.closest('[data-clear]');
  if (!button) return;
  if (button.dataset.clear === 'all') { $('reset').click(); $('reset').focus(); return; }
  if (button.dataset.clear === 'dates') { $('from').value = DATA.from; $('to').value = DATA.to; }
  else $(button.dataset.clear).value = '';
  query(); $('reset').focus();
});
function selectDay(event) {
  const target = event.target.closest('[data-date]');
  if (!target || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
  event.preventDefault(); $('from').value = target.dataset.date; $('to').value = target.dataset.date;
  query(); $('from').focus();
}
$('trend').addEventListener('click', selectDay); $('trend').addEventListener('keydown', selectDay);
$('daily-table').addEventListener('click', selectDay);
$('execution-trend').addEventListener('click', selectDay); $('execution-trend').addEventListener('keydown', selectDay);
$('request-summary').addEventListener('click', event => {
  const button = event.target.closest('[data-request-type]');
  if (!button) return;
  $('requestType').value = $('requestType').value === button.dataset.requestType ? '' : button.dataset.requestType;
  query(); $('requestType').focus();
});
$('sort').addEventListener('change', () => { pageIndex = 0; renderDetails(); });
$('simulation-sort').addEventListener('change', renderSimulations);
$('execution-session-toggle').addEventListener('click', () => { showAllExecutionSessions = !showAllExecutionSessions; renderExecutionTables(currentExecutionRows); });
$('previous').addEventListener('click', () => { pageIndex--; renderDetails(); });
$('next').addEventListener('click', () => { pageIndex++; renderDetails(); });
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => {
  $('to').value = DATA.to;
  $('from').value = button.dataset.days === 'all' ? DATA.from : [DATA.from, shiftDate(DATA.to, 1 - Number(button.dataset.days))].sort().at(-1);
  query();
});
$('reset').addEventListener('click', () => {
  for (const key of DIMENSIONS) $(key).value = '';
  $('from').value = DATA.from; $('to').value = DATA.to; query();
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  switchView(button.dataset.view);
  document.querySelector(`.views [data-view="${activeView}"]`).focus();
});
window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
window.addEventListener('resize', () => { if (activeView === 'overview') renderTrend(calendar); else if (activeView === 'execution' && currentExecutionRows.length) renderExecutionTrend(currentExecutionRows); });
for (const button of document.querySelectorAll('[data-help]')) button.addEventListener('click', () => openInfo(button.dataset.help));
$('info').addEventListener('click', () => openInfo()); $('snapshot').addEventListener('click', () => openInfo());
$('close-info').addEventListener('click', () => $('information').close());
$('print').addEventListener('click', () => window.print());
$('export').addEventListener('click', () => {
  const columns = ['date', ...DIMENSIONS, ...TOKEN_FIELDS, 'totalTokens', 'allTokens', 'knownCost', 'estimatedCost', 'coverage'];
  const url = URL.createObjectURL(new Blob([toCsv(currentRows, columns)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pi-usage-daily-${currentFilters.from}-${currentFilters.to}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('execution-export').addEventListener('click', () => {
  const rows = currentExecutionRows.map(row => ({ ...row, execHistogram: JSON.stringify(row.execHistogram) }));
  const url = URL.createObjectURL(new Blob([toCsv(rows, executionCsvColumns)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pi-usage-execution-${currentFilters.from}-${currentFilters.to}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render(); switchView(location.hash.slice(1) || 'overview');
