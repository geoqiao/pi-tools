import {
  createProvider,
  type Provider, type Tool,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai/compat";
import { BASE_URL, PROVIDER_ID, type CatalogSnapshot } from "./catalog.ts";
import { createDiscovery, fresh } from "./discovery.ts";
import { compatibleApi } from "./transport.ts";

export interface ProviderOptions {
  cachePath: string;
  disabledTools: readonly Tool[];
  offline?: boolean;
  fetch?: typeof fetch;
}

export async function createOpenCodeFreeProvider(options: ProviderOptions) {
  const discovery = createDiscovery(options.cachePath, options.fetch);
  let snapshot: CatalogSnapshot | undefined;
  let lastError: string | undefined;
  let cacheError: string | undefined;
  const save = async (value: CatalogSnapshot) => {
    try { await discovery.save(value); cacheError = undefined; }
    catch (error) { cacheError = `Could not save model cache: ${error instanceof Error ? error.message : String(error)}`; }
  };
  try { snapshot = await discovery.load(); }
  catch (error) { cacheError = `Could not read model cache: ${error instanceof Error ? error.message : String(error)}`; }
  // Await discovery before registration: first-run RPC/list-models must see the models.
  if (!options.offline && !fresh(snapshot)) {
    try { snapshot = await discovery.fetch(); await save(snapshot); }
    catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  }

  const native = createProvider({
    id: PROVIDER_ID, name: "OpenCode Free", baseUrl: BASE_URL, models: [],
    auth: {
      apiKey: {
        name: "Anonymous free access",
        async resolve() { return { auth: { apiKey: "public" }, source: "OpenCode anonymous free tier" }; },
      },
    },
    api: {
      "openai-completions": compatibleApi(openAICompletionsApi(), options.disabledTools),
      "openai-responses": compatibleApi(openAIResponsesApi(), options.disabledTools),
    },
  });
  const provider: Provider = {
    ...native,
    getModels: () => snapshot?.models ?? [],
    async refreshModels(context) {
      // This provider owns one cache, independent of Pi's built-in provider cache.
      if (!context.allowNetwork || options.offline || (!context.force && fresh(snapshot))) return;
      try {
        const next = await discovery.fetch(context.signal);
        context.signal.throwIfAborted();
        if (await context.publish({ update: () => { snapshot = next; lastError = undefined; } })) await save(next);
      } catch (error) {
        if (!context.signal.aborted) lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
  return {
    provider,
    status() {
      const time = snapshot ? new Date(snapshot.checkedAt).toISOString() : "never";
      const skipped = Object.entries(snapshot?.skipped ?? {}).map(([why, n]) => `${n} ${why}`).join(", ");
      return [
        `OpenCode Free: ${provider.getModels().length} models. Last catalog check: ${time}.`,
        options.offline ? "Offline: using the saved catalog." : fresh(snapshot) ? "Catalog is fresh." : "Catalog is stale or unavailable.",
        skipped ? `Excluded: ${skipped}.` : "",
        lastError ? `Refresh failed: ${lastError} The previous catalog was retained.` : "",
        cacheError ?? "",
        !snapshot ? "No cached models. Run /opencode-free refresh with network access." : "",
      ].filter(Boolean).join("\n");
    },
    warning: () => lastError ?? cacheError ?? (!snapshot ? "No cached OpenCode free models are available." : undefined),
  };
}
