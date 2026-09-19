#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { collect, SOURCES } from '../src/collect.js';
import { dateKey, shiftDate, validatePrices, normalizeData } from '../src/analytics.js';
import { writeReport } from '../src/report.js';
import { runQuota } from '../src/quotas/index.js';

const SOURCE_COUNT = SOURCES.length;
const OPTIONAL_PRICE_KEYS = ['cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];

const HELP = `pi-usage — 获取使用数据，本地生成分析报告；不上传统计数据。

  pi-usage [--days 90] [--out /path/to/empty-directory]
  --sources pi-coding-agent,codex  只采集指定工具（默认全部 ${SOURCE_COUNT} 类）
  --prices /path/prices.json      本地价格覆盖：{ "models": { "model-id": { "input": 5, "cacheRead": 0.5, "cacheWrite": 6.25, "cacheWrite5m": 6.25, "cacheWrite1h": 10, "output": 30, "reasoning": 30 } } }
  --timezone Asia/Shanghai        日期分组时区（默认系统时区）
  --input /path/usage.json        从本地 buckets / sessions / execution 重新分析，不采集数据源
  --offline                      禁止来源网络请求（Cursor 不可用；Antigravity 仅本地 DB）
  --list-sources                  列出数据源
  quota discover --json          仅本地发现订阅配额产品
  quota fetch --product <id> --json 只查询明确选择的订阅配额
  --version                      查看已安装版本
  --help                         查看帮助

报告为独立 HTML，双击打开；同目录包含 details.csv、sessions.csv、execution.csv、usage.json。
日期快捷筛选只使用报告已采集范围；需要更多天数或来源时请重新生成报告。
成本为价格快照下的估算，不是账单；未定价模型不会按 0 元计算。
`;

function projectPriceOverride(rate) {
  const projected = {
    input: rate.input,
    output: rate.output,
    cacheRead: rate.cacheRead,
    reasoning: rate.reasoning,
  };
  for (const key of OPTIONAL_PRICE_KEYS) {
    if (Object.hasOwn(rate, key)) projected[key] = rate[key];
  }
  return {
    ...projected,
    provider: 'local-override',
    reference: '用户本地价格表',
  };
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === 'quota') {
    await runQuota(args.slice(1));
    return;
  }
  const { values } = parseArgs({ args, options: {
    days: { type: 'string', default: '90' }, out: { type: 'string' }, sources: { type: 'string' },
    prices: { type: 'string' }, timezone: { type: 'string' }, input: { type: 'string' },
    offline: { type: 'boolean' }, 'list-sources': { type: 'boolean' }, version: { type: 'boolean', short: 'v' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(HELP); return; }
  if (values.version) {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(packageJson.version);
    return;
  }
  if (values['list-sources']) { console.log(SOURCES.join('\n')); return; }
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 3660) throw new Error('--days 必须是 1–3660 的整数');
  const timeZone = values.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat('en', { timeZone });
  const selected = values.sources ? [...new Set(values.sources.split(','))] : SOURCES;
  if (selected.some(id => !SOURCES.includes(id))) throw new Error('未知数据源；使用 --list-sources 查看');
  const snapshot = JSON.parse(await readFile(new URL('../data/prices.json', import.meta.url), 'utf8'));
  const overrides = values.prices ? JSON.parse(await readFile(values.prices, 'utf8')).models : {};
  validatePrices(snapshot.models); validatePrices(overrides);
  const prices = { ...snapshot.models, ...Object.fromEntries(
    Object.entries(overrides).map(([id, rate]) => [id, projectPriceOverride(rate)])
  ) };
  if (values.offline) process.env.PI_USAGE_OFFLINE = '1';
  const now = new Date();
  const to = dateKey(now, timeZone), from = shiftDate(to, 1 - days);
  let data;
  if (values.input) {
    const raw = JSON.parse(await readFile(values.input, 'utf8'));
    data = { ...normalizeData(raw, { timeZone, prices }), statuses: [{ source: 'local-import', state: 'ok', note: '从本地文件重新计价；来源完整性未验证。' }] };
  } else {
    data = await collect({ sources: selected, timeZone, prices, onProgress: source => console.error(`读取 ${source}…`) });
  }
  data.buckets = data.buckets.filter(row => row.date >= from && row.date <= to);
  data.sessions = data.sessions.filter(row => row.date >= from && row.date <= to);
  data.execution = data.execution.filter(row => row.date >= from && row.date <= to);
  const report = {
    schemaVersion: 2, generatedAt: now.toISOString(), from, to, timeZone,
    collectionScope: {
      kind: values.input ? 'import' : values.sources ? 'selected' : 'all',
      sources: values.input ? [...new Set([...data.buckets, ...data.sessions, ...data.execution].map(row => row.source))].sort() : [...selected],
      offline: process.env.PI_USAGE_OFFLINE === '1',
    },
    priceSnapshot: {
      date: snapshot.snapshotDate,
      source: snapshot.source,
      supplementalPricing: snapshot.supplementalPricing,
      overrideCount: Object.keys(overrides).length,
    },
    prices, ...data,
  };
  const file = await writeReport(report, values.out);
  console.log(file);
  if (data.statuses.some(s => s.state === 'error' || s.state === 'partial' || s.warningCount > 0)) {
    console.error('注意：部分数据源未完整读取；请查看报告中的数据源状态。');
  }
  return file;
}

main().catch(error => { console.error(`pi-usage: ${error.message}`); process.exitCode = 1; });
