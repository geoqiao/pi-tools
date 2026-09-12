async page => {
  // Synthetic demo reports only; never open a private report or a real session export.
  const errors = [], requests = [];
  const onError = error => errors.push(error.message);
  const onRequest = request => { if (/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/.test(request.url())) requests.push(request.url()); };
  page.on('pageerror', onError); page.on('request', onRequest);
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/, route => route.abort());
  const check = (value, message) => { if (!value) throw new Error(message); };
  const initialURL = page.url();
  check(/^(?:file|https?):/.test(initialURL), 'Browser check must start from a synthetic demo URL');
  const relatedURL = name => page.evaluate(({ base, name: directory }) => new URL(`./${directory}/index.html`, base).href, { base: initialURL, name });
  const shortURL = await relatedURL('short');
  const legacyURL = await relatedURL('legacy');
  const view = async name => {
    await page.locator(`.views [data-view="${name}"]`).first().click();
    await page.waitForTimeout(25);
  };
  const clearFocus = () => page.evaluate(() => document.activeElement?.blur());
  const readData = () => page.evaluate(() => {
    const match = document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/);
    return JSON.parse(match[1]);
  });
  const sum = rows => rows.reduce((total, row) => total + row.allTokens, 0);
  const selectTotal = (data, from, to, filters = {}) => sum(data.buckets.filter(row => row.date >= from && row.date <= to
    && Object.entries(filters).every(([key, value]) => !value || row[key] === value)));
  const activePresets = () => page.locator('[data-days][aria-pressed="true"]');

  await page.goto(initialURL);
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1050 });
  const data = await readData();
  check(await page.locator('.views [data-view]').count() === 4 && !await page.locator('.views [data-view="execution"]').count(), 'Execution remains a fifth primary navigation view');
  const expectedTotal = selectTotal(data, data.from, data.to);
  check(await page.locator('#total-value').getAttribute('data-value') === String(expectedTotal), 'UI total differs from synthetic snapshot');
  check((await activePresets().count()) === 1 && await activePresets().first().getAttribute('data-days') === 'all', 'Initial date preset is not uniquely active');
  check(await page.locator('#collection-scope').textContent() === '指定来源 · 3 个 · 离线', 'Collection scope summary missing');
  check((await page.locator('#collection-scope').getAttribute('title')).includes('合成演示'), 'Synthetic scope disclosure missing');
  check((await page.locator('#harness-ranking .rank-row').count()) === 3, 'Main dashboard lost non-Pi Harness data');
  check((await page.locator('#overview .overview-section').count()) === 3, 'Overview does not have three reading sections');
  check(await page.locator('#overview .overview-section').nth(0).textContent().then(text => text.includes('整体用量') && text.includes('每日趋势')), 'Overview section one is unclear');
  check(await page.locator('#overview .overview-section').nth(1).textContent().then(text => text.includes('Harness') && text.includes('Tool-call') && text.includes('模型') && text.includes('典型一天')), 'Overview section two is incomplete');
  check(await page.locator('#overview .overview-section').nth(2).textContent().then(text => text.includes('Code Mode 成本影响')), 'Overview section three is missing');
  check(await page.locator('#composition .token-part').count() === 4, 'Four token classes missing');
  check((await page.locator('#total-value').textContent()).includes('M') && (await page.locator('#net-value').textContent()).includes('M'), 'Top Token values are not in M');
  check((await page.locator('.token-part strong').allTextContents()).every(text => text.includes('M')), 'Top Token composition is not in M');

  // Named ranges are inclusive, end at the report cutoff, and never clip to the available window.
  for (const [preset, from] of [['7', '2026-08-30'], ['30', '2026-08-07'], ['90', '2026-06-08'], ['all', '2026-06-08']]) {
    await page.locator(`[data-days="${preset}"]`).click();
    check(await page.locator('#from').inputValue() === from && await page.locator('#to').inputValue() === data.to, `${preset}D dates are not anchored to report cutoff`);
    check((await activePresets().count()) === 1 && await activePresets().first().getAttribute('data-days') === preset, `${preset}D active feedback is not unique`);
    check(await page.locator('#total-value').getAttribute('data-value') === String(selectTotal(data, from, data.to)), `${preset}D raw total differs`);
  }
  await page.locator('#reset').click();

  // All dimensions compose with AND; a dimension drilldown does not replace earlier filters.
  for (const [key, value] of [['source', 'codex'], ['model', 'gpt-5.4'], ['project', 'atlas'], ['hostname', 'local-device'], ['requestType', 'tool']]) {
    await page.locator(`#${key}`).selectOption(value);
  }
  const andExpected = selectTotal(data, data.from, data.to, { source: 'codex', model: 'gpt-5.4', project: 'atlas', hostname: 'local-device', requestType: 'tool' });
  check(await page.locator('#total-value').getAttribute('data-value') === String(andExpected), 'Dimension filters are not AND-composed');
  check(await page.locator('#breadcrumbs [data-clear]').count() === 6, 'Combined filters are not all represented');
  await page.locator('#reset').click();

  // Request classification is response-level usage, not independent execution count.
  const requestTotals = await page.evaluate(() => {
    const types = ['non_tool', 'tool', 'other'];
    const data = JSON.parse(document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/)[1]);
    const rows = data.buckets.filter(row => row.date >= data.from && row.date <= data.to);
    return Object.fromEntries(types.map(type => [type, rows.filter(row => (row.requestType ?? 'other') === type).reduce((n, row) => n + row.allTokens, 0)]));
  });
  check(Object.values(requestTotals).reduce((a, b) => a + b, 0) === expectedTotal, 'Tool-call classification lost Token usage');
  check((await page.locator('#classification-note').textContent()).includes('不是执行次数'), 'Tool-call response-level disclaimer missing');

  // The page CSV keeps raw token counts while the UI uses M.
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { window.__qaCsv = blob; return original(blob); };
  });
  const csvDownloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const csvDownload = await csvDownloadPromise;
  check(csvDownload.suggestedFilename().startsWith('pi-usage-daily-') && await csvDownload.failure() === null, 'Daily CSV download failed');
  const csvCheck = await page.evaluate(async () => {
    const text = await window.__qaCsv.text();
    const cells = [...text.matchAll(/"((?:[^"]|"")*)"(?=,|\r\n|$)/g)].map(match => match[1].replaceAll('""', '"'));
    const headers = cells.slice(0, 15), rows = [];
    for (let index = 15; index < cells.length; index += 15) rows.push(cells.slice(index, index + 15));
    const allIndex = headers.indexOf('allTokens');
    const source = JSON.parse(document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/)[1]);
    return { headers, rows, rawTotal: rows.reduce((n, row) => n + Number(row[allIndex]), 0), expected: source.buckets.reduce((n, row) => n + row.allTokens, 0), firstRaw: rows[0]?.[allIndex] };
  });
  check(csvCheck.headers.length === 15 && csvCheck.rawTotal === csvCheck.expected && /^\d+$/.test(csvCheck.firstRaw), 'CSV token values were formatted for display');

  await view('percentiles');
  check(!(await page.locator('#token-quantile-details').getAttribute('open')), 'Full Token details should start collapsed');
  check(await page.locator('#quantile-charts .summary-stat').count() === 3 && await page.locator('#cost-stats .summary-stat').count() === 3, 'Primary distribution summary cards missing');
  const primarySize = await page.locator('#quantile-charts .summary-stat>strong').first().evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize), text: element.textContent }));
  check(primarySize.font >= 18 && primarySize.text.includes('M'), 'Primary Token statistic is still too small or not in M');
  const distributionHeight = await page.locator('.analysis-grid').evaluate(grid => {
    const boxes = [...grid.children].map(node => node.getBoundingClientRect().height);
    return { difference: Math.abs(boxes[0] - boxes[1]), left: boxes[0], right: boxes[1] };
  });
  check(distributionHeight.difference < 180, 'Daily distribution cards still have a large equal-height blank area');
  await page.locator('#token-quantile-details summary').click();
  check(await page.locator('#quantiles tbody tr').count() === 6 && (await page.locator('#quantiles').textContent()).includes('M'), 'Collapsed full six-metric Token table missing or not in M');
  check((await page.locator('#quantiles th').allTextContents()).some(text => text.includes('M')), 'Token percentile headings do not declare M');
  await page.locator('#token-quantile-details summary').click();
  check((await page.locator('#daily-table').textContent()).includes('M'), 'Daily drilldown Token values are not in M');

  await view('simulation');
  check(await page.locator('#simulations tbody tr').count() === new Set(data.buckets.map(row => row.model)).size, 'Model pricing view lost models');
  await view('records');
  check(await page.locator('#details th').allTextContents().then(headers => headers.some(header => header.includes('Token（M'))), 'Details headers do not declare M');

  // The old execution route is a compatibility link to the third overview section.
  // Retain navigation/keyboard/export-adjacent regressions while reorganizing views.
  await page.locator('#reset').click(); await view('overview');
  const firstDay = page.locator('#trend [data-date]').first();
  const selectedDay = await firstDay.getAttribute('data-date');
  await firstDay.focus(); await page.keyboard.press('Enter');
  check(await page.locator('#from').inputValue() === selectedDay && await page.locator('#to').inputValue() === selectedDay, 'Keyboard chart drilldown failed');
  await page.locator('#reset').click();
  await page.locator('#harness-ranking .rank-row').first().click();
  check(Boolean(await page.locator('#source').inputValue()), 'Harness chart drilldown failed');
  await page.locator('#reset').click();
  for (const type of ['non_tool', 'tool', 'other']) {
    await page.locator(`[data-request-type="${type}"]`).click();
    check(await page.locator('#requestType').inputValue() === type && Number(await page.locator('#total-value').getAttribute('data-value')) === requestTotals[type], 'Tool-call chart filter differs from source usage');
  }
  await page.locator('#reset').click(); await view('records');
  const firstPage = await page.locator('#page-status').textContent();
  await page.locator('#next').click();
  check(await page.locator('#page-status').textContent() !== firstPage, 'Detail pagination did not advance');
  await page.locator('#previous').click();
  check(await page.locator('#page-status').textContent() === firstPage, 'Detail pagination did not return');
  await view('simulation');
  check(await page.locator('#simulations tbody tr').count() === new Set(data.buckets.map(row => row.model)).size, 'Model repricing candidates lost models');
  await page.locator('#info').click();
  check(await page.locator('#information').isVisible(), 'Information dialog did not open');
  await page.keyboard.press('Escape');
  check(await page.locator('#information').isHidden() && await page.locator('#info').evaluate(node => node === document.activeElement), 'Dialog did not close and restore focus');
  await page.locator('#reset').click();
  await page.evaluate(() => { window.location.hash = '#execution'; });
  await page.waitForTimeout(60);
  check(!await page.locator('#overview').isHidden() && page.url().endsWith('#overview'), 'Legacy execution route did not map to overview');
  const codeBox = await page.locator('#code-mode-counterfactual').boundingBox();
  // The section is near the document end, so the browser's maximum scroll can
  // leave a small top offset while still bringing the whole CM panel into view.
  check(codeBox && codeBox.y < 400, 'Legacy execution route did not scroll to Code Mode cost section');
  check(await page.locator('#counterfactual-comparison tbody tr').count() === 3, 'Code Mode comparison is not visible in the main dashboard');
  check(await page.locator('#counterfactual-batching').isVisible() && await page.locator('#counterfactual-cache').isVisible(), 'Key Code Mode assumptions are not prominent');
  check((await page.locator('.counterfactual-brief').textContent()).includes('非账单') && !await page.locator('#counterfactual-assumptions').getAttribute('open'), 'Code Mode long disclosure was not collapsed');
  check((await page.locator('#counterfactual-coverage').textContent()).includes('候选响应') && (await page.locator('#counterfactual-coverage').textContent()).includes('价格覆盖'), 'Candidate/price coverage summary missing');
  const defaultDelta = await page.locator('#counterfactual-comparison').getAttribute('data-delta-total-tokens');
  check(defaultDelta !== '' && (await page.locator('#counterfactual-comparison').textContent()).includes('同队列已知小计'), 'Counterfactual coverage or paired subtotal disclosure missing');
  check(/\$\d+\.\d{3,6}/.test(await page.locator('#counterfactual-comparison').textContent()), 'Counterfactual money lost precise display');

  await page.locator('#counterfactual-assumptions > summary').click();
  await page.locator('#counterfactual-advanced summary').click();
  check(await page.locator('#counterfactual-sensitivity tbody tr').count() === 6, 'Counterfactual sensitivity rows missing');
  check((await page.locator('[data-token-note="counterfactual-extra-output"]').textContent()).includes('M'), 'Raw Token parameter M equivalence note missing');
  await page.locator('#counterfactual-batching').selectOption('2');
  check(await page.locator('#counterfactual-comparison').getAttribute('data-delta-total-tokens') !== defaultDelta, 'Batching control did not change counterfactual numbers');
  await page.locator('#counterfactual-extra-output').fill('10');
  await page.locator('#counterfactual-tool-context').fill('5');
  check((await page.locator('#counterfactual-default-caption').textContent()).includes('不表示实测为零'), 'Advanced assumption caption missing');
  await page.locator('#counterfactual-extra-output').fill('0'); await page.locator('#counterfactual-tool-context').fill('0');
  await page.locator('#counterfactual-cache').selectOption('0'); await page.locator('#counterfactual-batching').selectOption('2');
  await page.locator('#counterfactual-output-replay-share').fill('0');
  const replayZeroInput = await page.locator('#counterfactual-comparison').getAttribute('data-direct-input-tokens');
  const replayZeroOutput = await page.locator('#counterfactual-comparison').getAttribute('data-direct-output-tokens');
  await page.locator('#counterfactual-output-replay-share').fill('1');
  check(Number(await page.locator('#counterfactual-comparison').getAttribute('data-direct-input-tokens')) > Number(replayZeroInput)
    && await page.locator('#counterfactual-comparison').getAttribute('data-direct-output-tokens') === replayZeroOutput, 'Output replay did not only add input');
  await page.locator('#counterfactual-output-replay-share').fill('1.1');
  check(await page.locator('#counterfactual-error').isVisible() && (await page.locator('#counterfactual-error').textContent()).includes('r') && await page.locator('#counterfactual-export').isDisabled(), 'Invalid replay share left stale output enabled');
  await page.locator('#counterfactual-output-replay-share').fill('0');
  await page.locator('#counterfactual-batching').selectOption('all');
  await page.locator('#counterfactual-cache').selectOption('observed');
  await page.locator('#model').selectOption('gpt-5.4');
  await page.locator('#counterfactual-code-overhead').fill('999999');
  check((await page.locator('#counterfactual-comparison').getAttribute('data-delta-total-tokens')).startsWith('-')
    && (await page.locator('#counterfactual-comparison').getAttribute('data-delta-cost')).startsWith('-')
    && (await page.locator('#counterfactual-interpretation').textContent()).includes('USD 差额为负'), 'Negative Code Mode impact is not retained');

  const executionOnlyModel = [...new Set(data.execution.map(row => row.model))].find(model => !new Set(data.buckets.map(row => row.model)).has(model));
  check(executionOnlyModel, 'Synthetic execution-only model missing');
  await page.locator('#reset').click();
  await page.locator('#model').selectOption(executionOnlyModel);
  const unknownText = await page.locator('#counterfactual-comparison').textContent();
  check(unknownText.includes('未完整定价') && !unknownText.includes('$0.00') && (await page.locator('#counterfactual-coverage').textContent()).includes('pricedRows=0'), 'Unknown cost was presented as free');
  check(await page.locator('#empty-state').isVisible() && await page.locator('#execution-scope').textContent() !== '无执行证据', 'Execution-only model was incorrectly removed from evidence');
  await page.locator('#reset').click();
  await page.locator('#counterfactual-batching').selectOption('1'); await page.locator('#counterfactual-cache').selectOption('observed'); await page.locator('#counterfactual-code-overhead').fill('0');
  const cfDownloadPromise = page.waitForEvent('download'); await page.locator('#counterfactual-export').click();
  const cfDownload = await cfDownloadPromise;
  check(cfDownload.suggestedFilename().startsWith('pi-usage-code-mode-counterfactual-') && await cfDownload.failure() === null, 'Counterfactual CSV download failed');
  check(await page.evaluate(async () => (await window.__qaCsv.text()).includes('toolsPerRound') && (await window.__qaCsv.text()).includes('eligibleRows') && (await window.__qaCsv.text()).includes('knownActualCost'), 'Counterfactual CSV omitted coverage or assumptions'));

  // Diagnostic metrics remain available but are folded away from the primary reading path.
  check(!await page.locator('#execution-diagnostics').getAttribute('open'), 'Execution diagnostics should be folded by default');
  await page.locator('#execution-diagnostics summary').click();
  check(await page.locator('#execution-data').isVisible() && await page.locator('#execution-histogram .execution-bin').count() === 6, 'Execution diagnostics did not expand');
  const executionShape = await page.evaluate(() => {
    const data = JSON.parse(document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/)[1]);
    const bins = [0, 0, 0, 0, 0, 0];
    for (const row of data.execution.filter(item => item.date >= data.from && item.date <= data.to)) {
      for (const [tools, count] of Object.entries(row.execHistogram ?? {})) bins[Math.min(5, Number(tools))] += count;
    }
    const complete = bins.reduce((total, count) => total + count, 0);
    const multi = bins.slice(2).reduce((total, count) => total + count, 0);
    return { bins, batchRate: complete ? multi / complete : null };
  });
  const renderedHistogram = await page.locator('#execution-histogram .execution-bin-value').allTextContents()
    .then(values => values.map(value => Number(value.replaceAll(',', ''))));
  check(JSON.stringify(renderedHistogram) === JSON.stringify(executionShape.bins), 'Execution histogram values do not match synthetic evidence');
  const renderedBatchRate = Number.parseFloat(await page.locator('#execution-batch-value').textContent()) / 100;
  check(Math.abs(renderedBatchRate - executionShape.batchRate) < 1e-9, 'Batch rate does not match synthetic histogram evidence');
  check((await page.locator('#execution-input-value').textContent()).includes('M') && (await page.locator('#execution-model-table th').allTextContents()).some(text => text.includes('平均输入（M）')), 'Execution Token UI is not in M');
  check((await page.locator('#execution-evidence').textContent()).includes('pending exec') && (await page.locator('#execution-evidence').textContent()).includes('unknown exec'), 'Execution coverage diagnostics missing');
  const executionDownloadPromise = page.waitForEvent('download'); await page.locator('#execution-export').click();
  const executionDownload = await executionDownloadPromise;
  check(executionDownload.suggestedFilename().startsWith('pi-usage-execution-') && await executionDownload.failure() === null, 'Execution CSV download failed');
  await page.locator('#execution-diagnostics summary').click();

  // A Harness filter with no execution evidence keeps the usage dashboard intact.
  await page.locator('#source').selectOption('codex');
  check(Number(await page.locator('#total-value').getAttribute('data-value')) === selectTotal(data, data.from, data.to, { source: 'codex' })
    && await page.locator('#empty-state').isHidden() && (await page.locator('#execution-scope').textContent()).includes('无执行证据'), 'Codex usage was filtered out because execution is Pi-only');
  await page.locator('#source').selectOption('claude-code');
  check(await page.locator('#empty-state').isHidden() && (await page.locator('#execution-scope').textContent()).includes('无执行证据'), 'Claude usage was filtered out because execution is Pi-only');
  await page.locator('#reset').click();

  // The demo generator writes this required sibling fixture beside the arbitrary
  // initial report directory. Missing or malformed fixtures fail the check.
  await page.goto(shortURL);
  const shortData = await readData();
  const shortRange = await page.evaluate(() => {
    const from = document.querySelector('#from').value, to = document.querySelector('#to').value;
    return { from, to, days: Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1 };
  });
  check(shortRange.days === 30 && shortData.from === shortRange.from && shortData.to === shortRange.to, 'Required short synthetic fixture is not a 30-day report');
  check(await page.locator('[data-days="90"]').isDisabled(), '90D was not disabled for a 30-day report');
  check((await page.locator('#preset-note').textContent()).includes('重新生成更宽范围报告'), 'Unavailable 90D explanation missing');
  check(await page.locator('#from').inputValue() === shortData.from && await page.locator('#to').inputValue() === shortData.to, 'Short report changed dates before applying a preset');

  // A legacy report without execution or collection-scope metadata remains an
  // explicit no-evidence state and cannot masquerade as all-source collection.
  await page.goto(legacyURL);
  const legacyData = await readData();
  check(!Object.hasOwn(legacyData, 'execution') && !Object.hasOwn(legacyData, 'collectionScope'), 'Legacy fixture unexpectedly gained new metadata');
  check(await page.locator('#collection-scope').textContent() === '采集范围未记录', 'Legacy collection scope was presented as known');
  check((await page.locator('#collection-scope-detail').textContent()).includes('不能证明全来源'), 'Legacy collection scope limitation is missing');
  check((await page.locator('#execution-scope').textContent()) === '无执行证据', 'Legacy execution absence was not explicit');
  await page.locator('#execution-diagnostics summary').click();
  check(await page.locator('#execution-empty').isVisible() && await page.locator('#execution-data').isHidden(), 'Legacy no-execution empty state regressed');
  await page.goto(initialURL);

  // Responsive pass and screenshots are synthetic evidence for README review.
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#reset').click(); await page.evaluate(() => window.scrollTo(0, 0)); await clearFocus();
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-overview.png', fullPage: true });
  await view('percentiles'); await clearFocus(); await page.screenshot({ path: '/tmp/pi-usage-bi-demo-percentiles.png', fullPage: true });
  await view('overview'); await page.locator('#execution-diagnostics summary').click();
  await page.locator('#execution-diagnostics summary').click(); await page.evaluate(() => { window.location.hash = '#execution'; }); await page.waitForTimeout(60); await clearFocus();
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-codemode.png', fullPage: true });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    for (const name of ['overview', 'percentiles', 'simulation', 'records']) {
      await view(name);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px in ${name}`);
    }
    await view('overview');
    for (const metric of ['tokens', 'outputTokens', 'cost']) {
      await page.locator('#trend-metric').selectOption(metric);
      check(await page.locator('#trend .axis-value').evaluateAll(nodes => nodes.length === 4 && nodes.every(node => {
        const box = node.getBBox(), width = node.ownerSVGElement.viewBox.baseVal.width;
        return box.x >= 0 && box.x + box.width <= width;
      })), `Clipped trend axis at ${width}px in ${metric}`);
    }
    await page.locator('#trend-metric').selectOption('tokens');
  }
  await view('overview'); await page.evaluate(() => window.scrollTo(0, 0));
  const mobileLayout = await page.evaluate(() => {
    document.querySelector('#total-value').textContent = '999,999.999999 M';
    const hosts = [...document.querySelectorAll('#metrics .total-metric,#metrics .cost-metric,#metrics .token-part,.daily-panel .summary-stat')];
    const children = [...document.querySelectorAll('#metrics strong,.daily-panel strong')];
    const overflow = hosts.filter(host => host.scrollWidth > host.clientWidth + 1)
      .map(host => ({ className: host.className, scrollWidth: host.scrollWidth, clientWidth: host.clientWidth }));
    const clipped = children.filter(child => {
      const host = child.closest('.total-metric,.cost-metric,.token-part,.summary-stat,.daily-hero');
      if (!host) return false;
      const box = child.getBoundingClientRect(), parent = host.getBoundingClientRect();
      return box.left < parent.left - 1 || box.right > parent.right + 1;
    }).map(child => child.textContent);
    return {
      total: document.querySelector('#total-value').textContent,
      overflow,
      clipped,
      ranges: [...document.querySelectorAll('.daily-panel .summary-stat>strong')].map(node => node.textContent),
      median: document.querySelector('#daily-median').textContent,
    };
  });
  check(mobileLayout.total === '999,999.999999 M' && mobileLayout.overflow.length === 0 && mobileLayout.clipped.length === 0, '390px Token cards overflow or clip a large M value');
  check(mobileLayout.median.includes('M') && mobileLayout.ranges.every(value => value.includes('M') && !value.includes('…')), 'Typical-day range values are missing, truncated, or not in M');
  // Restore actual synthetic state before saving a presentation artifact.
  await page.locator('#reset').click();
  check(Number(await page.locator('#total-value').getAttribute('data-value')) === expectedTotal
    && await page.locator('#total-value').textContent() !== '999,999.999999 M', 'Stress mutation leaked into the final screenshot');
  await clearFocus();
  await page.screenshot({ path: '/tmp/pi-usage-bi-demo-mobile.png', fullPage: true });
  check(errors.length === 0, errors.join('\n'));
  check(requests.length === 0, `External requests: ${requests.length}`);
  page.off('pageerror', onError); page.off('request', onRequest);
  return { passed: true, total: expectedTotal, shortFixture: true, legacyFixture: true, screenshots: ['/tmp/pi-usage-bi-demo-overview.png', '/tmp/pi-usage-bi-demo-percentiles.png', '/tmp/pi-usage-bi-demo-codemode.png', '/tmp/pi-usage-bi-demo-mobile.png'], externalRequests: requests.length, errors };
}
