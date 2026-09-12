async page => {
  // Run only on synthetic demo/legacy fixture output; never use a private report or real session export for fixtures/screenshots.
  const errors = [], requests = [];
  const onError = error => errors.push(error.message);
  const onRequest = request => { if (/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/.test(request.url())) requests.push(request.url()); };
  page.on('pageerror', onError); page.on('request', onRequest);
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/, route => route.abort());
  await page.reload();
  const check = (value, message) => { if (!value) throw new Error(message); };
  const view = name => page.locator(`.views [data-view="${name}"]`).click();
  await view('overview');
  await page.setViewportSize({ width: 1440, height: 1050 });
  const expected = await page.evaluate(() => {
    const data = JSON.parse(document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/)[1]);
    const rows = data.buckets.filter(r => r.date >= data.from && r.date <= data.to);
    const typeTotals = Object.fromEntries(['non_tool', 'tool', 'other'].map(k => [k, rows.filter(r => (r.requestType ?? 'other') === k).reduce((n, r) => n + r.allTokens, 0)]));
    const execution = (data.execution ?? []).filter(r => r.date >= data.from && r.date <= data.to), histogram = {};
    let execCalls = 0, completeExecs = 0, multiToolSamples = 0, pendingExecs = 0, unknownExecs = 0;
    for (const row of execution) {
      execCalls += row.execCalls; pendingExecs += row.pendingExecs; unknownExecs += row.unknownExecs;
      for (const [value, count] of Object.entries(row.execHistogram ?? {})) { histogram[value] = (histogram[value] ?? 0) + count; completeExecs += count; if (Number(value) >= 2) multiToolSamples += count; }
    }
    const exactBins = [0, 1, 2, 3, 4].map(value => histogram[value] ?? 0);
    exactBins.push(Object.entries(histogram).reduce((n, [value, count]) => n + (Number(value) >= 5 ? count : 0), 0));
    const executionOnlyModel = [...new Set(execution.map(r => r.model))].find(model => !new Set(rows.map(r => r.model)).has(model));
    return { total: rows.reduce((n, r) => n + r.allTokens, 0), typeTotals, models: new Set(rows.map(r => r.model)).size, demo: rows.some(r => r.model === 'unknown-preview'), execution: { responseCount: execution.length, execCalls, completeExecs, multiToolSamples, multiToolRate: completeExecs ? multiToolSamples / completeExecs : null, pendingExecs, unknownExecs, exactBins, executionOnlyModel } };
  });
  const total = async () => Number(await page.locator('#total-value').getAttribute('data-value'));
  const initialCount = await page.locator('#page-status').textContent();
  check(await total() === expected.total, 'UI total differs from snapshot');
  check(Object.values(expected.typeTotals).reduce((a, b) => a + b, 0) === expected.total, 'Request classification lost tokens');
  check(await page.locator('#composition .token-part').count() === 4, 'Four token classes missing');
  check(await page.locator('#distribution-metric').inputValue() === 'allTokens', 'Ranking must default to tokens');
  check(!await page.locator('#include-zero').isChecked(), 'Must default to usage days');
  check(await page.locator('#quantiles tbody tr').count() === 6, 'Missing all six token distributions');
  check(await page.locator('#quantiles th').count() === 8, 'Missing Min/Max');
  check(await page.locator('#simulations tbody tr').count() === expected.models, 'Simulation candidates lost models');
  check(await page.locator('#simulations th').count() === 9, 'Simulation interval or six values missing');
  check(await page.locator('#request-summary button').count() === 3, 'Request categories missing');
  for (const type of ['non_tool', 'tool', 'other']) {
    await page.locator(`#request-summary [data-request-type="${type}"]`).click();
    check(await page.locator('#requestType').inputValue() === type, 'Request graphic did not set shared filter');
    check(await total() === expected.typeTotals[type], `Incorrect ${type} total`);
    await page.locator('#reset').click();
  }
  await page.locator('#requestType').selectOption('tool');
  await page.locator('#distribution-dimension').selectOption('requestType');
  check(await page.locator('#distributions .rank-row').count() === (expected.typeTotals.tool ? 1 : 0), 'Request filter did not link ranking');
  await page.locator('#breadcrumbs [data-clear="all"]').click();
  check(await total() === expected.total, 'Reset changed totals');
  await page.locator('#harness-ranking button').first().click();
  check((await page.locator('#source').inputValue()).length > 0, 'Harness drilldown failed');
  await page.locator('#distribution-dimension').selectOption('model');
  await page.locator('#distributions button').first().click();
  check((await page.locator('#model').inputValue()).length > 0, 'Model drilldown failed');
  // Every dimension must be AND-composed with the existing selection.
  await page.locator('#distribution-dimension').selectOption('project');
  await page.locator('#distributions button').first().click();
  await page.locator('#distribution-dimension').selectOption('hostname');
  await page.locator('#distributions button').first().click();
  check(await page.locator('#breadcrumbs [data-clear]').count() === 5, 'Combined filters missing');
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { window.__qaCsv = blob; return original(blob); };
  });
  await page.locator('#export').click();
  const download = await downloadPromise;
  check(download.suggestedFilename().startsWith('pi-usage-daily-'), 'Wrong CSV grain');
  check(await download.failure() === null, 'Download blocked');
  const csvCheck = await page.evaluate(async () => {
    const text = await window.__qaCsv.text();
    // toCsv emits quoted cells; match cells independently of embedded newlines.
    const cells = [...text.matchAll(/"((?:[^"]|"")*)"(?=,|\r\n|$)/g)].map(m => m[1].replaceAll('""', '"'));
    const headers = cells.slice(0, 15), allIndex = headers.indexOf('allTokens'), typeIndex = headers.indexOf('requestType');
    const rows = [];
    for (let i = 15; i < cells.length; i += 15) rows.push(cells.slice(i, i + 15));
    const source = JSON.parse(document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/)[1]);
    const dims = ['source', 'model', 'project', 'hostname', 'requestType'];
    const from = document.getElementById('from').value, to = document.getElementById('to').value;
    const selected = source.buckets.filter(r => r.date >= from && r.date <= to && dims.every(k => !document.getElementById(k).value || r[k] === document.getElementById(k).value));
    const keys = new Set(selected.map(r => JSON.stringify([r.date, ...dims.map(k => r[k] ?? 'other')])));
    return { valid: headers.length === 15 && rows.every(r => r.length === 15), exported: rows.reduce((n, r) => n + Number(r[allIndex]), 0), expected: selected.reduce((n, r) => n + r.allTokens, 0), rows: rows.length, expectedRows: keys.size, types: rows.every(r => ['non_tool', 'tool', 'other'].includes(r[typeIndex])) };
  });
  check(csvCheck.valid && csvCheck.types && csvCheck.exported === csvCheck.expected && csvCheck.rows === csvCheck.expectedRows, 'CSV does not match filtered daily aggregation');
  check(await total() === csvCheck.expected, 'Filtered UI and CSV disagree');
  await page.locator('#breadcrumbs [data-clear="model"]').click();
  check(await page.locator('#model').inputValue() === '', 'Removable filter failed');
  await page.locator('#reset').click();
  const fullDownload = page.waitForEvent('download');
  await page.locator('#export').click(); await fullDownload;
  const fullCsv = await page.evaluate(async () => {
    const cells = [...(await window.__qaCsv.text()).matchAll(/"((?:[^"]|"")*)"(?=,|\r\n|$)/g)].map(m => m[1].replaceAll('""', '"'));
    const headers = cells.slice(0, 15), tokenIndex = headers.indexOf('allTokens'), typeIndex = headers.indexOf('requestType');
    const totals = { non_tool: 0, tool: 0, other: 0 };
    for (let i = 15; i < cells.length; i += 15) totals[cells[i + typeIndex]] += Number(cells[i + tokenIndex]);
    return { total: Object.values(totals).reduce((a, b) => a + b, 0), types: totals };
  });
  check(fullCsv.total === expected.total && Object.keys(expected.typeTotals).every(k => fullCsv.types[k] === expected.typeTotals[k]), 'Full CSV total or classification changed');
  await view('execution');
  check(await page.locator('#code-mode-counterfactual').isVisible(), 'Code Mode cost panel missing');
  check((await page.locator('#code-mode-counterfactual-title').textContent()).includes('Code Mode 成本影响'), 'Code Mode cost panel title missing');
  check(await page.locator('#counterfactual-batching').inputValue() === '1' && await page.locator('#counterfactual-cache').inputValue() === 'observed' && await page.locator('#counterfactual-output-replay-share').inputValue() === '0', 'Counterfactual defaults changed');
  if (expected.execution.responseCount) {
    check(await page.locator('#counterfactual-sensitivity tbody tr').count() === 6, 'Counterfactual sensitivity rows missing');
    check((await page.locator('#counterfactual-sensitivity').textContent()).includes('价格覆盖') && (await page.locator('#counterfactual-sensitivity').textContent()).includes('覆盖不同的金额小计不能直接比较'), 'Sensitivity price coverage disclosure missing');
    const defaultCounterfactualDelta = await page.locator('#counterfactual-comparison').getAttribute('data-delta-total-tokens');
    check(await page.locator('#counterfactual-comparison tbody tr').count() === 3 && defaultCounterfactualDelta !== '', 'Counterfactual comparison is empty');
    check((await page.locator('#counterfactual-comparison').textContent()).includes('同队列已知小计'), 'Partial paired cost subtotal is not disclosed');
    check(/\$\d+\.\d{3,6}/.test(await page.locator('#counterfactual-comparison').textContent()), 'Counterfactual money was rounded to the ordinary two-decimal view');
    await page.locator('#counterfactual-batching').selectOption('2');
    const batchCounterfactualDelta = await page.locator('#counterfactual-comparison').getAttribute('data-delta-total-tokens');
    check(batchCounterfactualDelta !== defaultCounterfactualDelta, 'Batching control did not change counterfactual numbers');
    await page.locator('#counterfactual-advanced summary').click();
    await page.locator('#counterfactual-extra-output').fill('10');
    await page.locator('#counterfactual-tool-context').fill('5');
    check((await page.locator('#counterfactual-default-caption').textContent()).includes('不表示实测为零'), 'Advanced assumption caption missing');
    await page.locator('#counterfactual-extra-output').fill('0');
    await page.locator('#counterfactual-tool-context').fill('0');
    await page.locator('#counterfactual-code-overhead').fill('0');
    await page.locator('#counterfactual-cache').selectOption('0');
    await page.locator('#counterfactual-batching').selectOption('all');
    await page.locator('#model').selectOption('gpt-5.4');
    await page.locator('#counterfactual-batching').selectOption('2');
    await page.locator('#counterfactual-output-replay-share').fill('0');
    const replayZeroInput = await page.locator('#counterfactual-comparison').getAttribute('data-direct-input-tokens');
    const replayZeroOutput = await page.locator('#counterfactual-comparison').getAttribute('data-direct-output-tokens');
    await page.locator('#counterfactual-output-replay-share').fill('1');
    const replayFullInput = await page.locator('#counterfactual-comparison').getAttribute('data-direct-input-tokens');
    const replayFullOutput = await page.locator('#counterfactual-comparison').getAttribute('data-direct-output-tokens');
    check(Number(replayFullInput) > Number(replayZeroInput) && replayFullOutput === replayZeroOutput, 'Output replay share did not add input without changing output tokens');
    await page.locator('#counterfactual-batching').selectOption('all');
    await page.locator('#counterfactual-output-replay-share').fill('0');
    const allReplayZero = await page.locator('#counterfactual-comparison').getAttribute('data-direct-input-tokens');
    await page.locator('#counterfactual-output-replay-share').fill('1');
    const allReplayFull = await page.locator('#counterfactual-comparison').getAttribute('data-direct-input-tokens');
    check(allReplayFull === allReplayZero && await page.locator('#counterfactual-comparison').getAttribute('data-direct-output-tokens') === replayZeroOutput, 'All batching incorrectly changed for output replay without added rounds');
    await page.locator('#counterfactual-output-replay-share').fill('0');
    await page.locator('#counterfactual-output-replay-share').fill('1.1');
    check(await page.locator('#counterfactual-error').isVisible() && (await page.locator('#counterfactual-error').textContent()).includes('r'), 'Invalid output replay share was accepted');
    check(await page.locator('#counterfactual-export').isDisabled(), 'Invalid output replay share left a stale export enabled');
    await page.locator('#counterfactual-output-replay-share').fill('0');
    check(await page.locator('#counterfactual-comparison').isVisible(), 'Priced Code Mode scenario disappeared under model filter');
    await page.locator('#counterfactual-code-overhead').fill('999999');
    check((await page.locator('#counterfactual-comparison').getAttribute('data-delta-total-tokens')).startsWith('-'), 'Negative token delta is not shown');
    check((await page.locator('#counterfactual-comparison').getAttribute('data-delta-cost')).startsWith('-'), 'Negative cost delta is not shown');
    check((await page.locator('#counterfactual-interpretation').textContent()).includes('USD 差额为负'), 'Negative delta interpretation is missing');
    await page.locator('#model').selectOption(expected.execution.executionOnlyModel);
    check((await page.locator('#counterfactual-comparison').textContent()).includes('未完整定价') && !(await page.locator('#counterfactual-comparison').textContent()).includes('$0.00'), 'Zero priced rows were presented as free');
    check((await page.locator('#counterfactual-coverage').textContent()).includes('pricedRows=0'), 'Zero price coverage is not disclosed');
    await page.locator('#reset').click();
    await page.locator('#counterfactual-batching').selectOption('1');
    await page.locator('#counterfactual-cache').selectOption('observed');
    await page.locator('#counterfactual-code-overhead').fill('0');
    const counterfactualDownload = page.waitForEvent('download');
    await page.locator('#counterfactual-export').click();
    const counterfactualFile = await counterfactualDownload;
    check(counterfactualFile.suggestedFilename().startsWith('pi-usage-code-mode-counterfactual-'), 'Wrong counterfactual CSV filename');
    check(await counterfactualFile.failure() === null, 'Counterfactual CSV download blocked');
    check(await page.evaluate(async () => {
      const csv = await window.__qaCsv.text();
      return csv.includes('toolsPerRound') && csv.includes('outputReplayShare') && csv.includes('assumption') && csv.includes('eligibleRows') && csv.includes('knownActualCost') && csv.includes('filterFrom');
    }), 'Counterfactual CSV omitted parameters or coverage assumptions');
  }
  if (expected.execution.responseCount) {
    check(await page.locator('#execution-empty').isHidden(), 'Execution evidence was incorrectly empty');
    check(await page.locator('#execution-response-value').textContent() === String(expected.execution.responseCount), 'Recorded response count differs from snapshot');
    check((await page.locator('#execution-response-value').evaluate(el => el.parentElement.textContent)).includes('不等于完整 HTTP/API 请求或计费次数'), 'Assistant response disclaimer missing');
    const expectedMultiToolRate = expected.execution.multiToolRate == null ? '—' : `${(expected.execution.multiToolRate * 100).toFixed(1)}%`;
    check(await page.locator('#execution-batch-value').textContent() === expectedMultiToolRate, 'Batch coverage is not the histogram-derived multiToolRate');
    check((await page.locator('#execution-batch-note').textContent()).includes(`${expected.execution.multiToolSamples} / ${expected.execution.completeExecs}`), 'Batch coverage denominator is not complete exec samples');
    check(await page.locator('#execution-histogram .execution-bin').count() === 6, 'Execution histogram bins missing');
    const histogram = await page.locator('#execution-histogram .execution-bin-value').allTextContents();
    check(histogram.every((value, index) => Number(value.replaceAll(',', '')) === expected.execution.exactBins[index]), 'Execution histogram did not merge exact samples');
    await page.locator('#execution-trend-metric').selectOption('medianTools');
    check(await page.locator('#execution-trend .execution-missing-mark').count() > 0, 'Missing execution trend days have no visible non-numeric marker');
    await page.locator('#execution-trend-metric').selectOption('meanTools');
    check((await page.locator('#execution-evidence').textContent()).includes(`pending exec${expected.execution.pendingExecs}`), 'Pending coverage missing');
    check((await page.locator('#execution-evidence').textContent()).includes(`unknown exec${expected.execution.unknownExecs}`), 'Unknown coverage missing');
    check(await page.locator('#execution-model-table tbody tr').count() > 0 && await page.locator('#execution-session-table tbody tr').count() > 0, 'Model/session execution tables missing');
    check(await page.locator('#execution-session-table tbody tr').count() <= 20 && await page.locator('#execution-session-toggle').isVisible(), 'Session table is not bounded');
    await page.locator('#execution-session-toggle').click();
    check(await page.locator('#execution-session-table tbody tr').count() > 20, 'Session table expand failed');
    await page.locator('#execution-session-toggle').click();
    check(await page.locator('#model option').allTextContents().then(values => values.includes(expected.execution.executionOnlyModel)), 'Execution-only model missing from shared filters');
    const executionDownload = page.waitForEvent('download');
    await page.locator('#execution-export').click();
    const executionFile = await executionDownload;
    check(executionFile.suggestedFilename().startsWith('pi-usage-execution-'), 'Wrong execution CSV filename');
    check(await executionFile.failure() === null, 'Execution CSV download blocked');
    if (expected.execution.executionOnlyModel) {
      await page.locator('#model').selectOption(expected.execution.executionOnlyModel);
      check(await page.locator('#execution-empty').isHidden(), 'Execution-only model was filtered out');
      check(await page.locator('#empty-state').isVisible(), 'Legacy empty state lost for execution-only model');
      await page.locator('#reset').click();
    }
  } else {
    check(await page.locator('#execution-empty').isVisible(), 'Missing execution empty state');
  }
  await page.locator('#reset').click();
  await view('execution');
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-execution.png' });
  await page.locator('#reset').click();
  await view('overview');
  if (expected.demo) {
    await page.locator('#distribution-dimension').selectOption('model');
    await page.locator('#distribution-metric').selectOption('knownCost');
    const unknown = page.locator('#distributions [data-value="unknown-preview"]');
    check((await unknown.innerText()).includes('未定价') && !(await unknown.innerText()).includes('$0.00'), 'Unknown cost presented as free');
    await page.locator('#model').selectOption('unknown-preview');
    await page.locator('#distribution-dimension').selectOption('project');
    const longName = page.locator('#distributions button').first();
    check((await longName.getAttribute('data-value')).length > 250, 'Missing long/hostile synthetic name');
    await longName.click();
    check(await page.locator('svg[onload]').count() === 0, 'Project name became executable HTML');
    const edgeDownload = page.waitForEvent('download');
    await page.locator('#export').click();
    await edgeDownload;
    check(await page.evaluate(async () => (await window.__qaCsv.text()).includes('"\'=lab,""<svg')), 'CSV formula protection lost');
    await page.locator('#project').selectOption('');
    check((await page.locator('#cost-value').innerText()).includes('未定价'), 'Unknown total presented as free');
    check((await page.locator('#simulations').textContent()).includes('$'), 'Unknown original model prevented repricing');
    await page.locator('#model').selectOption('gpt-5.4');
    await page.locator('#source').selectOption('claude-code');
    check(await page.locator('#empty-state').isVisible(), 'Empty state missing');
    check((await page.locator('#simulations').textContent()).includes('无样本'), 'Empty sample simulated as zero');
    await page.locator('#reset').click();
  }
  await view('percentiles');
  const activeDays = Number(await page.locator('#quantiles tbody tr').first().locator('td').nth(1).textContent());
  await page.locator('#include-zero').check();
  const allDays = Number(await page.locator('#quantiles tbody tr').first().locator('td').nth(1).textContent());
  check(allDays >= activeDays, 'Calendar sample smaller than usage sample');
  if (allDays > activeDays) check(await page.locator('#quantiles tbody tr').first().locator('td').nth(2).textContent() === '0', 'Missing assumed zero minimum');
  check((await page.locator('#sample-note').textContent()).includes('假设'), 'Zero assumption not disclosed');
  await page.locator('#include-zero').uncheck();
  check((await page.locator('#cost-sample-note').textContent()).includes('排除'), 'Cost exclusions not disclosed');
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-percentiles.png' });
  await view('simulation');
  for (const sort of ['p90', 'min', 'max', 'p50']) {
    await page.locator('#simulation-sort').selectOption(sort);
    const index = { min: 3, p50: 5, p90: 7, max: 8 }[sort];
    const amounts = await page.locator(`#simulations tbody td:nth-child(${index + 1})`).allTextContents();
    const numbers = amounts.filter(s => s !== '—').map(s => Number(s.replace(/[$,]/g, '')));
    check(numbers.every((v, i) => !i || v >= numbers[i - 1]), `Simulation ${sort} order incorrect`);
  }
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-simulation.png' });
  await view('overview');
  await page.locator('#trend-metric').selectOption('cost');
  check((await page.locator('#trend-legend').textContent()).includes('金额'), 'Cost legend mismatch');
  await page.locator('#trend [data-date]').nth(1).focus();
  await page.keyboard.press('Enter');
  check(await page.locator('#from').inputValue() === await page.locator('#to').inputValue(), 'Keyboard date drilldown failed');
  await page.locator('#reset').click();
  await page.locator('#from').fill('');
  await page.locator('#from').dispatchEvent('change');
  check(await page.locator('#export').isDisabled(), 'Invalid dates allowed misleading export');
  check(await page.locator('#execution-export').isDisabled(), 'Invalid dates allowed execution export');
  check(await total() === expected.total, 'Invalid dates changed valid result');
  await page.locator('#reset').click();
  await view('records');
  check(await page.locator('#page-status').textContent() === initialCount, 'Reset lost details');
  if (await page.locator('#next').isEnabled()) {
    await page.locator('#next').click();
    check((await page.locator('#page-status').textContent()).startsWith('2 /'), 'Pagination failed');
    await page.locator('#previous').click();
  }
  await page.locator('#info').click();
  check(await page.locator('#information').isVisible(), 'Information entry failed');
  await page.keyboard.press('Escape');
  check(!await page.locator('#information').isVisible(), 'Escape did not close dialog');
  check(await page.locator('#info').evaluate(el => el === document.activeElement), 'Dialog lost focus return');
  await view('overview');
  await page.locator('#distribution-dimension').selectOption('model');
  await page.locator('#distribution-metric').selectOption('allTokens');
  await page.locator('#trend-metric').selectOption('tokens');
  check(await page.locator('svg[onload], img, iframe').count() === 0, 'Unescaped HTML or external resource');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['overview', 'percentiles', 'simulation', 'records', 'execution']) {
    await view(name);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Mobile overflow in ${name}`);
  }
  await view('overview');
  if (expected.demo) {
    await page.locator('#distribution-dimension').selectOption('project');
    await page.locator('#distributions [data-value^="=lab"]').click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Long filter chip overflow');
    await page.locator('#reset').click();
    await page.locator('#distribution-dimension').selectOption('model');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-mobile.png', fullPage: true });
  check(await page.locator('#trend svg').getAttribute('viewBox').then(v => Number(v.split(' ')[2]) < 400), 'Mobile trend was not resized');
  await page.setViewportSize({ width: 1440, height: 1050 });
  check(errors.length === 0, errors.join('\n'));
  check(requests.length === 0, `External requests: ${requests.length}`);
  page.off('pageerror', onError); page.off('request', onRequest);
  return { passed: true, total: expected.total, requestTypeTotals: expected.typeTotals, csvCheck, fullCsv, activeDays, allDays, externalRequests: requests.length, errors };
}
