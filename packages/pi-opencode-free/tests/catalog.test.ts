import assert from "node:assert/strict";
import test from "node:test";
import { hasApi } from "@earendil-works/pi-ai";
import { buildCatalog, parseSnapshot } from "../src/catalog.ts";

export function metadata(id = "fresh-model", extra: Record<string, unknown> = {}) {
  return { id, name: id, cost: { input: 0, output: 0 }, reasoning: true, tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 100000, output: 1000 }, ...extra };
}
export function catalogs(entries: Record<string, unknown> = { "fresh-model": metadata() }) {
  return [{ data: Object.keys(entries).map(id => ({ id })) },
    { opencode: { npm: "@ai-sdk/openai-compatible", models: entries } }] as const;
}

test("discovers new IDs, includes free names without a suffix, and selects metadata protocols", () => {
  const [zen, data] = catalogs({
    "new-model": metadata(), "big-pickle": metadata(),
    responses: metadata("responses", { provider: { npm: "@ai-sdk/openai" } }),
    paid: metadata("paid", { cost: { input: 0, output: 1 } }),
    cachedPaid: metadata("cachedPaid", { cost: { input: 0, output: 0, cache_write: 1 } }),
    noPrice: metadata("noPrice", { cost: {} }),
    old: metadata("old", { status: "deprecated" }),
    systemOne: metadata("systemOne", { provider: { npm: "@typesafe-ai/ai-sdk-provider" } }),
    incomplete: metadata("incomplete", { limit: {} }),
  });
  zen.data.push({ id: "missing" }, { id: "new-model" });
  const result = buildCatalog(zen, data);
  assert.deepEqual(result.models.map(m => [m.id, m.api]), [
    ["big-pickle", "openai-completions"], ["new-model", "openai-completions"], ["responses", "openai-responses"],
  ]);
  assert.equal(result.skipped["nonzero or unknown price"], 3);
  assert.equal(result.skipped.deprecated, 1);
  assert.equal(result.skipped["unsupported protocol"], 1);
  assert.equal(result.skipped["incomplete capabilities"], 1);
  assert.equal(result.skipped["missing metadata"], 1);
});

test("an authoritative price change removes every model; malformed or empty source is an error", () => {
  assert.equal(buildCatalog(...catalogs({ paid: metadata("paid", { cost: { input: 1, output: 1 } }) })).models.length, 0);
  assert.throws(() => buildCatalog({ data: [] }, catalogs()[1]));
  assert.throws(() => buildCatalog({ data: [{}] }, catalogs()[1]));
  assert.throws(() => buildCatalog(catalogs()[0], { opencode: { models: {} } }));
});

test("cache validation rejects paid models and foreign endpoints, strips untrusted headers", () => {
  const snapshot = buildCatalog(...catalogs());
  assert.deepEqual(parseSnapshot(snapshot), snapshot);
  assert.equal(parseSnapshot({ ...snapshot, version: 2 }), undefined);
  assert.equal(parseSnapshot({ ...snapshot, checkedAt: Date.now() + 120000 }), undefined);
  const withModel = (props: object) => ({ ...snapshot, models: [{ ...snapshot.models[0], ...props }] });
  assert.equal(parseSnapshot(withModel({ baseUrl: "https://example.com" })), undefined);
  assert.equal(parseSnapshot(withModel({ cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } })), undefined);
  assert.equal(parseSnapshot(withModel({ headers: { Authorization: "secret" } }))?.models[0].headers, undefined);
});

test("reasoning metadata survives cache restore without inventing unsupported effort levels", () => {
  const result = buildCatalog(...catalogs({
    responses: metadata("responses", {
      provider: { npm: "@ai-sdk/openai" },
      reasoning_options: [{ type: "effort", values: ["minimal", "high", "xhigh"] }],
    }),
    chat: metadata("chat", { reasoning_options: [], interleaved: { field: "reasoning_content" } }),
  }));
  const restored = parseSnapshot(result)!;
  assert.deepEqual(restored, result);
  assert.deepEqual(restored.models[1].thinkingLevelMap, {
    off: null, minimal: "minimal", low: null, medium: null, high: "high", xhigh: "xhigh", max: null,
  });
  const chat = restored.models[0];
  assert(hasApi(chat, "openai-completions"));
  assert.equal(chat.compat?.supportsReasoningEffort, false);
  assert.equal(chat.compat?.requiresReasoningContentOnAssistantMessages, true);
});
