import { hostname } from 'node:os';
import { parsers } from '../vendor/vibe-usage/src/parsers/index.js';
import { normalizeParserResult } from '../vendor/vibe-usage/src/parsers/contract.js';
import { normalizeData } from './analytics.js';

export const SOURCES = Object.keys(parsers);

export async function collect({ sources = SOURCES, timeZone, prices, onProgress = () => {} }) {
  const result = { buckets: [], sessions: [], execution: [], statuses: [] };
  for (const source of sources) {
    if (!Object.hasOwn(parsers, source)) throw new Error(`未知数据源：${source}`);
    onProgress(source);
    try {
      const raw = normalizeParserResult(source, await parsers[source]());
      const data = normalizeData(raw, { timeZone, prices, hostname: hostname() });
      result.buckets.push(...data.buckets);
      result.sessions.push(...data.sessions);
      result.execution.push(...data.execution);
      result.statuses.push({
        source, state: raw.skipped ? 'partial' : data.buckets.length || data.sessions.length || data.execution.length ? 'ok' : 'empty',
        buckets: data.buckets.length, sessions: data.sessions.length,
        warningCount: raw.warnings.length,
        // Do not embed arbitrary upstream exception strings or private filesystem paths.
        note: raw.indexing ? 'Codex 索引尚未完成；再次生成报告可从本地缓存继续。'
          : raw.skipped || raw.warnings.length ? '部分记录不可读取或数据源暂不可用；请检查本地文件权限、工具版本或来源登录状态。' : '',
      });
    } catch {
      result.statuses.push({ source, state: 'error', buckets: 0, sessions: 0, warningCount: 1,
        note: '解析失败；请检查数据源版本、文件权限、SQLite / zstd 支持；Cursor 请检查登录状态。' });
    }
    // Let CLI/host process pending cancellation between synchronous legacy parsers.
    await new Promise(resolve => setImmediate(resolve));
  }
  return result;
}
