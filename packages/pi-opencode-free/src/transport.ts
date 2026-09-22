import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createAssistantMessageEventStream,
  type AssistantMessage, type AssistantMessageEventStream, type Model,
  type ProviderHeaders, type ProviderStreams, type SimpleStreamOptions, type StreamOptions, type Tool,
} from "@earendil-works/pi-ai";
import { object } from "./catalog.ts";

const RESERVED = new Set(["authorization", "user-agent", "x-opencode-client", "x-opencode-session", "x-opencode-request", "x-opencode-project"]);

/** Stable per Pi session (including resume), fresh per request. These are routing IDs, not credentials. */
export function requestHeaders(sessionId: string, existing?: ProviderHeaders): ProviderHeaders {
  const headers = Object.fromEntries(Object.entries(existing ?? {}).filter(([k]) => !RESERVED.has(k.toLowerCase())));
  const time = ((BigInt(Date.now()) << 12n) & 0xffffffffffffn).toString(16).padStart(12, "0");
  return {
    ...headers,
    Authorization: "Bearer public",
    "User-Agent": "opencode/1.18.32",
    "x-opencode-client": "cli",
    "x-opencode-session": "ses_" + createHash("sha256").update(sessionId).digest("hex").slice(0, 26),
    "x-opencode-request": "prt_" + time + randomBytes(7).toString("hex"),
    "x-opencode-project": "global",
  };
}

function failure(model: Model<any>, error: unknown, aborted: boolean, previous?: AssistantMessage): AssistantMessage {
  return {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: previous?.usage ?? {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now(),
  };
}

/** Keep Pi's parser and transcript untouched; compatibility is applied to the serialized request only. */
export function compatibleApi(native: ProviderStreams, disabledTools: readonly Tool[]): ProviderStreams {
  const fallbackSession = randomUUID();
  const run = (
    method: "stream" | "streamSimple",
    model: Parameters<ProviderStreams["stream"]>[0],
    context: Parameters<ProviderStreams["stream"]>[1],
    options: SimpleStreamOptions = {},
  ): AssistantMessageEventStream => {
    const outer = createAssistantMessageEventStream();
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    let toolsForbidden = false;
    const adapted: SimpleStreamOptions = {
      ...options, signal, apiKey: "public",
      headers: requestHeaders(options.sessionId ?? fallbackSession, options.headers),
      async onPayload(payload, selectedModel) {
        // Preserve caller hooks, including hooks which replace the payload.
        const changed = await options.onPayload?.(payload, selectedModel);
        const body = object(changed ?? payload);
        if (!body) throw new Error("OpenCode provider expected an object request payload.");
        const tools = body.tools;
        if (tools !== undefined && !Array.isArray(tools)) throw new Error("Invalid OpenCode request tools.");
        const empty = !Array.isArray(tools) || tools.length === 0;
        toolsForbidden = empty || body.tool_choice === "none";
        // Zen's free Responses models currently accept only auto. The stream guard below
        // enforces the no-tool contract before any tool event can reach Pi.
        const choice = model.api === "openai-responses" ? "auto" : "none";
        if (!empty) return toolsForbidden ? { ...body, tool_choice: choice } : body;
        // Declaration-only compatibility for compaction and --no-tools. Never register/enable these in Pi.
        return {
          ...body, tool_choice: choice,
          tools: disabledTools.map(({ name, description, parameters }) => model.api === "openai-responses"
            ? { type: "function", name, description, parameters, strict: false }
            : { type: "function", function: { name, description, parameters, strict: false } }),
        };
      },
    };
    void (async () => {
      let previous: AssistantMessage | undefined;
      try {
        const source = method === "streamSimple"
          ? native.streamSimple(model, context, adapted)
          : native.stream(model, context, adapted as StreamOptions);
        for await (const event of source) {
          previous = "partial" in event ? event.partial : "message" in event ? event.message : event.error;
          if (toolsForbidden && (event.type.startsWith("toolcall_") || previous.content.some(c => c.type === "toolCall"))) {
            controller.abort();
            // Drain the cancelled native stream so a rejected tool call cannot leave a request running.
            await source.result();
            throw new Error("OpenCode returned a tool call while tool use was disabled; the call was not executed.");
          }
          outer.push(event);
        }
        outer.end(await source.result());
      } catch (error) {
        controller.abort();
        const message = failure(model, error, options.signal?.aborted ?? false, previous);
        outer.push({ type: "error", reason: message.stopReason as "error" | "aborted", error: message });
        outer.end(message);
      }
    })();
    return outer;
  };
  return {
    stream: (model, context, options) => run("stream", model, context, options),
    streamSimple: (model, context, options) => run("streamSimple", model, context, options),
  };
}
