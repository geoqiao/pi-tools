// Maintainer-only: node scripts/prices.js /path/to/models.dev-api.json YYYY-MM-DD
// Download the public catalog separately; this script and the runtime never refresh prices online.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [file, date] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Expected local catalog path and snapshot date');
const raw = readFileSync(file);
const catalog = JSON.parse(raw);
const models = {};
// Direct providers only. Avoid choosing an arbitrary reseller's price for a bare model id.
for (const provider of ['openai', 'anthropic', 'google', 'deepseek', 'moonshotai', 'zai', 'minimax', 'xai', 'mistral', 'xiaomi', 'kimi-for-coding']) {
  for (const model of Object.values(catalog[provider]?.models || {})) {
    const c = model.cost;
    if (!c || !Number.isFinite(c.input) || !Number.isFinite(c.output)) continue;
    if (model.modalities?.output?.some(type => type !== 'text')) continue;
    const entry = {
      input: c.input, output: c.output, cacheRead: c.cache_read ?? null,
      reasoning: c.reasoning ?? c.output,
      provider, reference: catalog[provider].doc,
      ...(c.cache_write != null ? { cacheWrite: c.cache_write } : {}),
      ...(c.tiers || c.context_over_200k ? { tiered: true } : {}),
    };
    models[`${provider}/${model.id}`] = entry;
    if (!Object.hasOwn(models, model.id)) models[model.id] = entry;
  }
}
writeFileSync(new URL('../data/prices.json', import.meta.url), JSON.stringify({
  snapshotDate: date, source: 'https://models.dev/api.json',
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  note: 'models.dev community-maintained snapshot, USD per million tokens; base text rates, not a billing invoice.',
  models,
}, null, 2) + '\n');
console.log(`${Object.keys(models).length} exact model identifiers`);
