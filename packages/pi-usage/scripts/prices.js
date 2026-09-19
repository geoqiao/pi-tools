// Maintainer-only: node scripts/prices.js /path/to/models.dev-api.json YYYY-MM-DD
// Download the public catalog separately; this script and the runtime never refresh prices online.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [file, date] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Expected local catalog path and snapshot date');
const raw = readFileSync(file);
const catalog = JSON.parse(raw);
const models = {};
const ANTHROPIC_PRICING_REFERENCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const ANTHROPIC_SUPPLEMENTAL_VERIFIED_DATE = '2026-09-19';
const ANTHROPIC_CACHE_WRITE_5M_MULTIPLIER = 1.25;
const ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER = 2;
// Direct providers only. Avoid choosing an arbitrary reseller's price for a bare model id.
for (const provider of ['openai', 'anthropic', 'google', 'deepseek', 'moonshotai', 'zai', 'minimax', 'xai', 'mistral', 'xiaomi', 'kimi-for-coding']) {
  for (const model of Object.values(catalog[provider]?.models || {})) {
    const c = model.cost;
    if (!c || !Number.isFinite(c.input) || !Number.isFinite(c.output)) continue;
    if (model.modalities?.output?.some(type => type !== 'text')) continue;
    const cacheWrite5m = provider === 'anthropic'
      ? c.input * ANTHROPIC_CACHE_WRITE_5M_MULTIPLIER
      : c.cache_write_5m ?? c.cache_write;
    const cacheWrite1h = provider === 'anthropic'
      ? c.input * ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER
      : c.cache_write_1h;
    const entry = {
      input: c.input, output: c.output, cacheRead: c.cache_read ?? null,
      reasoning: c.reasoning ?? c.output,
      provider, reference: catalog[provider].doc,
      ...(c.cache_write != null ? { cacheWrite: c.cache_write } : {}),
      ...(cacheWrite5m != null ? { cacheWrite5m } : {}),
      ...(cacheWrite1h != null ? { cacheWrite1h } : {}),
      ...(provider === 'anthropic' ? { cacheWriteReference: ANTHROPIC_PRICING_REFERENCE } : {}),
      ...(c.tiers || c.context_over_200k ? { tiered: true } : {}),
    };
    models[`${provider}/${model.id}`] = entry;
    if (!Object.hasOwn(models, model.id)) models[model.id] = entry;
  }
}
// Claude Code appends `-fast` only for the two currently supported Opus fast
// modes. Keep these as exact snapshot aliases: a generic suffix fallback would
// silently price unsupported or unknown service tiers.
for (const baseModel of ['claude-opus-5', 'claude-opus-4-8']) {
  const base = models[baseModel];
  if (!base || base.provider !== 'anthropic') continue;
  const fast = {
    ...base,
    input: base.input * 2,
    output: base.output * 2,
    cacheRead: base.cacheRead == null ? null : base.cacheRead * 2,
    reasoning: base.reasoning * 2,
    ...(base.cacheWrite != null ? { cacheWrite: base.cacheWrite * 2 } : {}),
    ...(base.cacheWrite5m != null ? { cacheWrite5m: base.cacheWrite5m * 2 } : {}),
    ...(base.cacheWrite1h != null ? { cacheWrite1h: base.cacheWrite1h * 2 } : {}),
    reference: ANTHROPIC_PRICING_REFERENCE,
    cacheWriteReference: ANTHROPIC_PRICING_REFERENCE,
    pricingSource: `Anthropic fast mode rates verified ${ANTHROPIC_SUPPLEMENTAL_VERIFIED_DATE}`,
  };
  models[`${baseModel}-fast`] = fast;
  models[`anthropic/${baseModel}-fast`] = fast;
}
writeFileSync(new URL('../data/prices.json', import.meta.url), JSON.stringify({
  snapshotDate: date, source: 'https://models.dev/api.json',
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  note: 'models.dev community-maintained snapshot, USD per million tokens; Anthropic TTL and supported fast-mode aliases use the official pricing reference; base text rates are not a billing invoice.',
  supplementalPricing: { source: ANTHROPIC_PRICING_REFERENCE, verifiedDate: ANTHROPIC_SUPPLEMENTAL_VERIFIED_DATE, note: 'Official Anthropic 5m/1h cache-write multipliers and the two supported fast-mode aliases are supplemental to the models.dev snapshot.' },
  models,
}, null, 2) + '\n');
console.log(`${Object.keys(models).length} exact model identifiers`);
