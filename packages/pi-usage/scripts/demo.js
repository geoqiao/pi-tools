// Synthetic data only; never include a personal report in a package or screenshot fixture.
import { readFile } from 'node:fs/promises';
import { normalizeData, shiftDate } from '../src/analytics.js';
import { writeReport } from '../src/report.js';
const snapshot = JSON.parse(await readFile(new URL('../data/prices.json', import.meta.url), 'utf8'));
const buckets = [], sessions = [];
const from = '2026-06-08', to = '2026-09-05';
const modelIds = ['gpt-5.4', 'claude-sonnet-4-6', 'deepseek-v4-flash', 'unknown-preview'];
// Exercise truncation, HTML escaping and CSV formula protection with synthetic names.
const projectIds = ['atlas', 'paper-trail', 'pi-tools', '=lab,"<svg onload=alert(1)>", ' + 'long-project/'.repeat(24)];
for (let d = 0; d < 90; d++) {
  if (d % 11 === 0) continue;
  for (let m = 0; m < 4; m++) {
    const date = shiftDate(from, d);
    const scale = ((d * 17 + m * 11) % 61 + 4) * 4700;
    buckets.push({ source: ['codex', 'claude-code', 'pi-coding-agent', 'pi-coding-agent'][m], model: modelIds[m], requestType: ['non_tool', 'tool', 'other'][(d + m) % 3], project: projectIds[m], hostname: 'local-device', bucketStart: `${date}T${String((d + m * 3) % 24).padStart(2, '0')}:00:00Z`, inputTokens: scale, cachedInputTokens: scale * 12, outputTokens: Math.floor(scale / 12), reasoningOutputTokens: Math.floor(scale / 18) });
    sessions.push({ source: buckets.at(-1).source, project: buckets.at(-1).project, hostname: 'local-device', sessionHash: `demo-${d}-${m}`, firstMessageAt: `${date}T08:00:00Z`, lastMessageAt: `${date}T09:00:00Z`, durationSeconds: 3600, activeSeconds: 1400 + d, messageCount: 60, userMessageCount: 8 });
  }
}
const data = normalizeData({ buckets, sessions }, { timeZone: 'Asia/Shanghai', prices: snapshot.models });
console.log(await writeReport({ schemaVersion: 1, from, to, timeZone: 'Asia/Shanghai', generatedAt: '2026-09-05T10:00:00Z', priceSnapshot: { date: snapshot.snapshotDate, source: snapshot.source, overrideCount: 0 }, prices: snapshot.models, ...data, statuses: [{ source: 'demo', state: 'ok', note: '合成演示数据，不是真实使用记录。' }] }, process.argv[2]));
