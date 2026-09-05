async page => {
  // Run on demo.js output, or an existing private report. Return aggregates only.
  const errors = [], requests = [];
  const onError = error => errors.push(error.message);
  const onRequest = request => { if (/^https?:/.test(request.url())) requests.push(request.url()); };
  page.on('pageerror', onError); page.on('request', onRequest);
  await page.context().route(/^https?:/, route => route.abort());
  await page.reload();
  const check = (value, message) => { if (!value) throw new Error(message); };
  const view = name => page.locator(`.views [data-view="${name}"]`).click();
  await view('overview');
  await page.setViewportSize({ width: 1440, height: 1050 });
  const expected = await page.evaluate(() => {
    const data = JSON.parse(document.querySelector('script').textContent.match(/const DATA = ([\s\S]*?);\nconst \$/)[1]);
    const rows = data.buckets.filter(r => r.date >= data.from && r.date <= data.to);
    const typeTotals = Object.fromEntries(['non_tool', 'tool', 'other'].map(k => [k, rows.filter(r => (r.requestType ?? 'other') === k).reduce((n, r) => n + r.allTokens, 0)]));
    return { total: rows.reduce((n, r) => n + r.allTokens, 0), typeTotals, models: new Set(rows.map(r => r.model)).size, demo: rows.some(r => r.model === 'unknown-preview') };
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
  await page.screenshot({ path: `/tmp/pi-usage-bi-${expected.demo ? 'demo' : 'real'}-percentiles.png` });
  await view('simulation');
  for (const sort of ['p90', 'min', 'max', 'p50']) {
    await page.locator('#simulation-sort').selectOption(sort);
    const index = { min: 3, p50: 5, p90: 7, max: 8 }[sort];
    const amounts = await page.locator(`#simulations tbody td:nth-child(${index + 1})`).allTextContents();
    const numbers = amounts.filter(s => s !== '—').map(s => Number(s.replace(/[$,]/g, '')));
    check(numbers.every((v, i) => !i || v >= numbers[i - 1]), `Simulation ${sort} order incorrect`);
  }
  await page.screenshot({ path: `/tmp/pi-usage-bi-${expected.demo ? 'demo' : 'real'}-simulation.png` });
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
  await page.screenshot({ path: `/tmp/pi-usage-bi-${expected.demo ? 'demo' : 'real'}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['overview', 'percentiles', 'simulation', 'records']) {
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
  await page.screenshot({ path: `/tmp/pi-usage-bi-${expected.demo ? 'demo' : 'real'}-mobile.png`, fullPage: true });
  check(await page.locator('#trend svg').getAttribute('viewBox').then(v => Number(v.split(' ')[2]) < 400), 'Mobile trend was not resized');
  await page.setViewportSize({ width: 1440, height: 1050 });
  check(errors.length === 0, errors.join('\n'));
  check(requests.length === 0, `External requests: ${requests.length}`);
  page.off('pageerror', onError); page.off('request', onRequest);
  return { passed: true, total: expected.total, requestTypeTotals: expected.typeTotals, csvCheck, fullCsv, activeDays, allDays, externalRequests: requests.length, errors };
}
