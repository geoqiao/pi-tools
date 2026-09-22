import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";

export const PROVIDER_ID = "opencode-free";
export const BASE_URL = "https://opencode.ai/zen/v1";
export const METADATA_URL = "https://models.dev/api.json";
export type SupportedApi = "openai-completions" | "openai-responses";
export type FreeModel = Model<SupportedApi>;

export interface CatalogSnapshot {
  version: 1;
  checkedAt: number;
  models: FreeModel[];
  skipped: Record<string, number>;
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function freePrice(value: unknown): boolean {
  const cost = object(value);
  return !!cost && cost.input === 0 && cost.output === 0
    && Object.values(cost).every((price) => price === 0);
}

const THINKING_LEVELS: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function thinkingMap(options: unknown): FreeModel["thinkingLevelMap"] {
  if (!Array.isArray(options)) return undefined;
  const effort = options.map(object).find(o => o?.type === "effort");
  const values = effort?.values;
  if (!Array.isArray(values)) return undefined;
  return Object.fromEntries(THINKING_LEVELS.map(level => [level, values.includes(level) ? level : null]));
}

/** Deliberately use provider metadata, not model-name suffixes or guessed protocols. */
export function buildCatalog(zen: unknown, metadata: unknown, now = Date.now()): CatalogSnapshot {
  const data = object(zen)?.data;
  const provider = object(object(metadata)?.opencode);
  const models = object(provider?.models);
  if (!Array.isArray(data) || data.length === 0 || !models || Object.keys(models).length === 0) {
    throw new Error("OpenCode/model metadata returned an empty or invalid catalog.");
  }
  const ids = new Set<string>();
  for (const item of data) {
    const id = object(item)?.id;
    if (typeof id !== "string" || !id.trim()) throw new Error("OpenCode returned an invalid model ID.");
    ids.add(id);
  }
  const result: CatalogSnapshot = { version: 1, checkedAt: now, models: [], skipped: {} };
  const skip = (reason: string) => { result.skipped[reason] = (result.skipped[reason] ?? 0) + 1; };
  for (const id of ids) {
    const entry = object(models[id]);
    if (!entry) { skip("missing metadata"); continue; }
    if (entry.status === "deprecated") { skip("deprecated"); continue; }
    if (!freePrice(entry.cost)) { skip("nonzero or unknown price"); continue; }
    const source = object(entry.provider);
    const npm = source?.npm ?? provider?.npm;
    const api = npm === "@ai-sdk/openai-compatible" ? "openai-completions"
      : npm === "@ai-sdk/openai" ? "openai-responses" : undefined;
    if (!api) { skip("unsupported protocol"); continue; }
    const limit = object(entry.limit);
    const modalities = object(entry.modalities);
    const inputs = modalities?.input;
    if (entry.tool_call !== true || !positiveInteger(limit?.context) || !positiveInteger(limit?.output)
      || !Array.isArray(inputs) || !inputs.includes("text") || typeof entry.reasoning !== "boolean") {
      skip("incomplete capabilities"); continue;
    }
    result.models.push({
      id, name: typeof entry.name === "string" ? entry.name : id,
      provider: PROVIDER_ID, api, baseUrl: BASE_URL,
      reasoning: entry.reasoning,
      ...(thinkingMap(entry.reasoning_options) ? { thinkingLevelMap: thinkingMap(entry.reasoning_options) } : {}),
      input: inputs.includes("image") ? ["text", "image"] : ["text"],
      contextWindow: limit.context, maxTokens: limit.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: api === "openai-completions"
        ? {
          supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens",
          ...(Array.isArray(entry.reasoning_options) && entry.reasoning_options.length === 0 ? { supportsReasoningEffort: false } : {}),
          ...(object(entry.interleaved)?.field === "reasoning_content" ? { requiresReasoningContentOnAssistantMessages: true } : {}),
        }
        : { sessionAffinityFormat: "openai-nosession" },
    });
  }
  result.models.sort((a, b) => a.id.localeCompare(b.id));
  // A valid catalog with no eligible models is authoritative: remove the old free list.
  return result;
}

/** Revalidate persisted data; never restore arbitrary URLs, headers, or paid models. */
export function parseSnapshot(value: unknown): CatalogSnapshot | undefined {
  const snapshot = object(value);
  if (snapshot?.version !== 1 || !positiveInteger(snapshot.checkedAt)
    || snapshot.checkedAt > Date.now() + 60_000 || !Array.isArray(snapshot.models)) return undefined;
  const seen = new Set<string>();
  const models: FreeModel[] = [];
  for (const raw of snapshot.models) {
    const m = object(raw);
    const cost = object(m?.cost);
    if (!m || typeof m.id !== "string" || !m.id || seen.has(m.id)
      || typeof m.name !== "string" || m.provider !== PROVIDER_ID || m.baseUrl !== BASE_URL
      || !["openai-completions", "openai-responses"].includes(String(m.api))
      || typeof m.reasoning !== "boolean" || !positiveInteger(m.contextWindow) || !positiveInteger(m.maxTokens)
      || !Array.isArray(m.input) || !m.input.includes("text") || m.input.some(x => x !== "text" && x !== "image")
      || !cost || ["input", "output", "cacheRead", "cacheWrite"].some(k => cost[k] !== 0)) return undefined;
    seen.add(m.id);
    const api = m.api as SupportedApi;
    const map = object(m.thinkingLevelMap);
    if (m.thinkingLevelMap !== undefined && (!map || Object.entries(map).some(([level, value]) =>
      !THINKING_LEVELS.includes(level as ModelThinkingLevel) || (value !== null && value !== level)))) return undefined;
    const compat = object(m.compat);
    models.push({
      id: m.id, name: m.name, provider: PROVIDER_ID, baseUrl: BASE_URL, api,
      reasoning: m.reasoning, input: m.input as ("text" | "image")[],
      ...(map ? { thinkingLevelMap: map as FreeModel["thinkingLevelMap"] } : {}),
      contextWindow: m.contextWindow, maxTokens: m.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: api === "openai-completions"
        ? {
          supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens",
          ...(compat?.supportsReasoningEffort === false ? { supportsReasoningEffort: false } : {}),
          ...(compat?.requiresReasoningContentOnAssistantMessages === true ? { requiresReasoningContentOnAssistantMessages: true } : {}),
        }
        : { sessionAffinityFormat: "openai-nosession" },
    });
  }
  const skipped = object(snapshot.skipped) ?? {};
  if (Object.values(skipped).some(x => typeof x !== "number" || !Number.isSafeInteger(x) || x < 0)) return undefined;
  return { version: 1, checkedAt: snapshot.checkedAt, models, skipped: skipped as Record<string, number> };
}
