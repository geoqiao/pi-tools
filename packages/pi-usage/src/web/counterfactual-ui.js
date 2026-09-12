// DOM-only Code Mode rendering. Estimation and cache invalidation stay in the
// report controller so this module has no data access or scheduling policy.
export function createCounterfactualUi({ getElement, esc, full, percent, tokenText }) {
  const $ = getElement;

  function counterfactualBatchLabel(value) {
    return value === 'all' ? 'all（理想独立批量）' : `B=${value}`;
  }
  function counterfactualCacheLabel(value) {
    if (value === 'observed') return 'observed（保持锚点缓存）';
    if (value === 0) return '0（冷缓存）';
    if (value === 1) return '1（全缓存）';
    return `h=${full(value)}`;
  }
  function counterfactualCount(value) {
    return value == null ? '—' : full(value);
  }
  function counterfactualCoverage(used, total) {
    if (used == null || total == null) return '—';
    return total > 0 ? `${full(used)} / ${full(total)} · ${percent(used / total)}` : `${full(used)} / ${full(total)} · —`;
  }
  function counterfactualSigned(value, formatter = full) {
    if (value == null) return '—';
    if (value === 0) return formatter(0);
    return `${value > 0 ? '+' : '-'}${formatter(Math.abs(value))}`;
  }
  function counterfactualMoney(value) {
    if (value == null) return '—';
    if (value !== 0 && Math.abs(value) < 0.000001) return `${value < 0 ? '-' : ''}<$0.000001`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(value);
  }
  function counterfactualSignedMoney(value) {
    if (value == null) return '—';
    if (value === 0) return counterfactualMoney(0);
    if (Math.abs(value) < 0.000001) return `${value > 0 ? '+' : '-'}<$0.000001`;
    return `${value > 0 ? '+' : '-'}${counterfactualMoney(Math.abs(value))}`;
  }
  function counterfactualTone(value) {
    return value == null || value === 0 ? 'counterfactual-neutral' : value > 0 ? 'counterfactual-positive' : 'counterfactual-negative';
  }
  function counterfactualCostText(result, segment, knownKey) {
    if (!(result?.eligibleRows > 0)) return '—';
    const cost = result[segment]?.cost;
    if (cost != null && result.pricedRows > 0) return counterfactualMoney(cost);
    const known = result.pricedRows > 0 ? result[knownKey] : null;
    return known == null ? '未完整定价' : `未完整定价 · 同队列已知小计 ${counterfactualMoney(known)}`;
  }
  function counterfactualDeltaCostText(result) {
    if (!(result?.eligibleRows > 0)) return '—';
    if (result.delta.cost != null && result.pricedRows > 0) return counterfactualSignedMoney(result.delta.cost);
    if (result.pricedRows > 0 && result.knownDeltaCost != null) return `未完整定价 · 同队列 ${counterfactualSignedMoney(result.knownDeltaCost)}`;
    return '未完整定价';
  }

  function updateTokenNotes() {
    for (const id of ['counterfactual-extra-output', 'counterfactual-tool-context', 'counterfactual-code-overhead']) {
      const value = Number($(id).value);
      const note = document.querySelector(`[data-token-note="${id}"]`);
      if (note) note.textContent = Number.isFinite(value) ? `参数单位例外 · 等值 ${tokenText(value)}` : '参数单位例外 · 等值 —';
    }
  }
  function clearOutput() {
    $('counterfactual-coverage').innerHTML = '';
    $('counterfactual-coverage-details').innerHTML = '';
    $('counterfactual-comparison').innerHTML = '<p class="empty">暂无 Code Mode 成本情景结果。</p>';
    $('counterfactual-interpretation').textContent = '';
    $('counterfactual-interpretation').className = 'counterfactual-interpretation';
    $('counterfactual-sensitivity').innerHTML = '';
    $('counterfactual-price-note').textContent = '';
    $('counterfactual-export').disabled = true;
    for (const key of ['toolsPerRound', 'cache', 'outputReplayShare', 'outputReplaySupported', 'deltaTotalTokens', 'deltaCost', 'directInputTokens', 'directOutputTokens']) delete $('counterfactual-comparison').dataset[key];
  }
  function setError(message) {
    const node = $('counterfactual-error');
    node.hidden = !message;
    node.textContent = message ?? '';
  }
  function renderCoverage(result) {
    const excluded = result.excluded ?? {};
    $('counterfactual-coverage').innerHTML = `<div class="counterfactual-stat"><span>候选响应</span><strong>${esc(counterfactualCount(result.candidateRows))}</strong><small>execCalls &gt; 0 · 仅当前筛选</small></div><div class="counterfactual-stat"><span>合格锚点</span><strong>${esc(counterfactualCoverage(result.eligibleRows, result.candidateRows))}</strong><small>完整 Code Mode 证据与 usage</small></div><div class="counterfactual-stat"><span>价格覆盖</span><strong>${esc(counterfactualCoverage(result.pricedRows, result.eligibleRows))}</strong><small>${result.pricedRows > 0 ? '同队列金额可估小计' : 'pricedRows=0：金额未知，不是 $0'}</small></div>`;
    $('counterfactual-coverage-details').innerHTML = `<div class="counterfactual-stat"><span>候选 exec</span><strong>${esc(counterfactualCount(result.candidateExecs))}</strong><small>候选响应内的 exec 总数</small></div><div class="counterfactual-stat"><span>合格 exec</span><strong>${esc(counterfactualCoverage(result.eligibleExecs, result.candidateExecs))}</strong><small>合格锚点内的 exec 总数</small></div><div class="counterfactual-stat"><span>新增直接轮次</span><strong>${esc(counterfactualCount(result.addedResponses))}</strong><small>当前 B 情景的 a 总和</small></div><div class="counterfactual-stat"><span>实际扣除 Code Mode 输出（M）</span><strong>${esc(tokenText(result.removedOutputTokens))}</strong><small>逐锚点 min(d, O) 后总计；d 为原始 Token 参数</small></div><div class="counterfactual-exclusions">排除原因：missingExec ${esc(counterfactualCount(excluded.missingExec))} · zeroTools ${esc(counterfactualCount(excluded.zeroTools))} · missingUsage ${esc(counterfactualCount(excluded.missingUsage))}。纯 JS / 零内部工具锚点不替换为直接调用。</div>`;
  }
  function renderComparison(result, options) {
    const deltaValue = result.delta.cost != null ? result.delta.cost : result.delta.totalTokens;
    const tone = counterfactualTone(deltaValue);
    const rows = [
      ['观察样本', tokenText(result.actual.inputTokens), tokenText(result.actual.outputTokens), tokenText(result.actual.totalTokens), counterfactualCostText(result, 'actual', 'knownActualCost'), false],
      ['直接调用情景', tokenText(result.direct.inputTokens), tokenText(result.direct.outputTokens), tokenText(result.direct.totalTokens), counterfactualCostText(result, 'direct', 'knownDirectCost'), false],
      ['差额（直接 − 观察）', counterfactualSigned(result.delta.inputTokens, tokenText), counterfactualSigned(result.delta.outputTokens, tokenText), counterfactualSigned(result.delta.totalTokens, tokenText), counterfactualDeltaCostText(result), true],
    ];
    $('counterfactual-comparison').innerHTML = `<div class="counterfactual-comparison-head"><strong>观察样本 vs 直接调用情景</strong><span>输入（M） / 输出（M） / Token 合计（M） / USD · 差额 = 直接 − 观察</span></div><div class="table-wrap"><table><thead><tr><th scope="col">方案</th><th scope="col">输入（M）</th><th scope="col">输出（M）</th><th scope="col">Token 合计（M）</th><th scope="col">USD</th></tr></thead><tbody>${rows.map(row => `<tr class="${row[5] ? 'counterfactual-delta-row' : ''}"><td>${esc(row[0])}</td><td class="${row[5] ? tone : ''}">${esc(row[1])}</td><td class="${row[5] ? tone : ''}">${esc(row[2])}</td><td class="${row[5] ? tone : ''}">${esc(row[3])}</td><td class="${row[5] ? tone : ''}">${esc(row[4])}</td></tr>`).join('')}</tbody></table></div>`;
    const comparison = $('counterfactual-comparison');
    comparison.dataset.toolsPerRound = String(options.toolsPerRound);
    comparison.dataset.cache = String(options.cache);
    comparison.dataset.outputReplayShare = String(options.outputReplayShare);
    comparison.dataset.outputReplaySupported = String(Object.hasOwn(result.options ?? {}, 'outputReplayShare'));
    comparison.dataset.deltaTotalTokens = result.delta.totalTokens == null ? '' : String(result.delta.totalTokens);
    comparison.dataset.deltaCost = result.delta.cost == null ? '' : String(result.delta.cost);
    comparison.dataset.directInputTokens = result.direct.inputTokens == null ? '' : String(result.direct.inputTokens);
    comparison.dataset.directOutputTokens = result.direct.outputTokens == null ? '' : String(result.direct.outputTokens);
  }
  function renderInterpretation(result) {
    const node = $('counterfactual-interpretation');
    let message = '', tone = 'counterfactual-neutral';
    if (!(result.eligibleRows > 0)) message = '没有合格锚点；不把缺证据、零工具或缺 usage 当作零成本。';
    else if (result.delta.cost != null) {
      tone = counterfactualTone(result.delta.cost);
      if (result.delta.cost > 0) message = 'USD 差额为正：直接调用在本情景更贵，因此 Code Mode 成本较低。';
      else if (result.delta.cost < 0) message = 'USD 差额为负：直接调用在本情景更便宜，因此 Code Mode 成本较高。';
      else message = 'USD 差额为 0：本情景的金额对照中性。';
    } else {
      const subtotal = result.pricedRows > 0 ? `同队列已知小计差额 ${counterfactualSignedMoney(result.knownDeltaCost)}` : '金额未完整定价';
      message = `${subtotal}；完整金额不据此推断。Token 合计差额 ${counterfactualSigned(result.delta.totalTokens, tokenText)}。`;
    }
    node.className = `counterfactual-interpretation ${tone}`;
    node.textContent = message;
  }
  function renderSensitivity(rows, options, getResult) {
    if (!(rows?.length) || !options) return null;
    const specs = [
      { group: '批处理', label: '串行', batch: 1, cache: options.cache },
      { group: '批处理', label: 'B=2', batch: 2, cache: options.cache },
      { group: '批处理', label: 'B=4', batch: 4, cache: options.cache },
      { group: '批处理', label: 'all', batch: 'all', cache: options.cache },
      { group: '缓存', label: '冷缓存', batch: options.toolsPerRound, cache: 0 },
      { group: '缓存', label: '全缓存', batch: options.toolsPerRound, cache: 1 },
    ];
    let firstError = null;
    const cells = specs.map(spec => {
      try {
        const result = getResult({ ...options, toolsPerRound: spec.batch, cache: spec.cache });
        const tone = counterfactualTone(result.delta.cost);
        return `<tr><td>${esc(spec.group)}</td><td>${esc(spec.label)}</td><td>${esc(counterfactualBatchLabel(spec.batch))}</td><td>${esc(counterfactualCacheLabel(spec.cache))}</td><td>${esc(counterfactualCount(result.addedResponses))}</td><td>${esc(counterfactualCoverage(result.pricedRows, result.eligibleRows))}</td><td class="counterfactual-delta-cell ${tone}">${esc(counterfactualSigned(result.delta.totalTokens, tokenText))}</td><td class="counterfactual-delta-cell ${tone}">${esc(counterfactualDeltaCostText(result))}</td></tr>`;
      } catch (error) {
        firstError ??= error instanceof Error ? error.message : String(error);
        return `<tr><td>${esc(spec.group)}</td><td>${esc(spec.label)}</td><td>${esc(counterfactualBatchLabel(spec.batch))}</td><td>${esc(counterfactualCacheLabel(spec.cache))}</td><td colspan="4">不可用：${esc(firstError)}</td></tr>`;
      }
    }).join('');
    $('counterfactual-sensitivity').innerHTML = `<div class="counterfactual-sensitivity-head"><strong>敏感性对照</strong><span>条件比较，不是置信区间或上下界</span></div><div class="table-wrap"><table><thead><tr><th scope="col">组别</th><th scope="col">情景</th><th scope="col">B</th><th scope="col">缓存 h</th><th scope="col">新增直接轮次</th><th scope="col">价格覆盖</th><th scope="col">Token Δ（M）</th><th scope="col">USD Δ</th></tr></thead><tbody>${cells}</tbody></table></div><p class="counterfactual-caption">每行的 pricedRows / eligibleRows 可能不同；覆盖不同的金额小计不能直接比较。</p>`;
    return firstError;
  }

  return {
    updateTokenNotes,
    clearOutput,
    setError,
    renderCoverage,
    renderComparison,
    renderInterpretation,
    renderSensitivity,
    cacheLabel: counterfactualCacheLabel,
  };
}
