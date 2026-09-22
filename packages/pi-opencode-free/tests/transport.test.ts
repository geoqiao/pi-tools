import assert from "node:assert/strict";
import test from "node:test";
import { type Tool } from "@earendil-works/pi-ai";
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai/compat";
import { compatibleApi, requestHeaders } from "../src/transport.ts";
import { buildCatalog } from "../src/catalog.ts";
import type { ProviderStreams, AssistantMessage, StreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const model = buildCatalog({ data: [{ id: "free" }] }, { opencode: {
  npm: "@ai-sdk/openai-compatible", models: { free: { name: "free", cost: { input: 0, output: 0 },
    reasoning: false, tool_call: true, modalities: { input: ["text"] }, limit: { context: 10000, output: 1000 } } },
} }).models[0];
const defs = [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }] as Tool[];

test("reserved headers cannot leak credentials; session IDs are stable and request IDs fresh", () => {
  const a = requestHeaders("pi-session", { authorization: "Bearer secret", "USER-AGENT": "pi", "X-Test": "kept" });
  const b = requestHeaders("pi-session");
  assert.equal(a.authorization, undefined);
  assert.equal(a.Authorization, "Bearer public");
  assert.equal(a["X-Test"], "kept");
  assert.equal(a["x-opencode-session"], b["x-opencode-session"]);
  assert.notEqual(a["x-opencode-request"], b["x-opencode-request"]);
  assert.notEqual(a["x-opencode-session"], requestHeaders("other")["x-opencode-session"]);
  assert.match(String(a["x-opencode-session"]), /^ses_[a-f0-9]{12}[a-zA-Z0-9]{14}$/);
});

function fakeNative(initial: object, received: { payload?: any; options?: StreamOptions }, callTool = false): ProviderStreams {
  const stream: ProviderStreams["stream"] = (m, _context, options) => {
    const s = createAssistantMessageEventStream();
    void (async () => {
      received.options = options;
      received.payload = await options?.onPayload?.(structuredClone(initial), m) ?? initial;
      const message: AssistantMessage = {
        role: "assistant", api: m.api, provider: m.provider, model: m.id,
        content: callTool ? [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] : [{ type: "text", text: "ok" }],
        stopReason: callTool ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      s.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); s.end(message);
    })();
    return s;
  };
  return { stream, streamSimple: stream };
}

test("no-tool compatibility applies to both protocols and blocks a malicious/unexpected tool call", async () => {
  for (const api of ["openai-completions", "openai-responses"] as const) {
    const received: { payload?: any; options?: StreamOptions } = {};
    const wrapper = compatibleApi(fakeNative({ messages: [{ role: "system", content: "PI" }] }, received, true), defs);
    const stream = wrapper.streamSimple({ ...model, api }, { messages: [] }, { apiKey: "account-secret" });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage!, /not executed/);
    assert.deepEqual(result.content, []);
    assert.equal(events.some(e => e.type === "done" || e.type.startsWith("toolcall_")), false);
    assert.equal(received.payload.tool_choice, api === "openai-responses" ? "auto" : "none");
    assert.equal(received.options?.apiKey, "public");
    const declared = received.payload.tools[0];
    assert.equal(api === "openai-responses" ? declared.name : declared.function.name, "read");
    assert.deepEqual(received.payload.messages, [{ role: "system", content: "PI" }]);
  }
});

test("caller payload hooks and actual tools are preserved; provider does not add executable tools", async () => {
  const received: { payload?: any } = {};
  const tools = [{ type: "function", function: { name: "custom_tool", parameters: {} } }];
  const wrapper = compatibleApi(fakeNative({ tools, messages: [{ role: "user", content: "hello" }] }, received), defs);
  const result = await wrapper.streamSimple(model, { messages: [] }, {
    onPayload: p => ({ ...(p as object), temperature: 0.2 }),
  }).result();
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(received.payload.tools, tools);
  assert.equal(received.payload.temperature, 0.2);
  assert.equal(received.payload.tool_choice, undefined);
});

test("native serializers receive anonymous headers, unchanged system/history, and caller fetch", async () => {
  for (const api of ["openai-completions", "openai-responses"] as const) {
    let captured: any;
    const wrapper = compatibleApi(api === "openai-completions" ? openAICompletionsApi() : openAIResponsesApi(), defs);
    const result = await wrapper.streamSimple({ ...model, api, headers: { authorization: "Bearer model-secret" } }, {
      systemPrompt: "EXACT_PI_SYSTEM", messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    }, {
      apiKey: "secret", headers: { authorization: "Bearer caller-secret" }, maxRetries: 0,
      fetch: async (_url, init) => {
        captured = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
        return Response.json({ error: { message: "intentional fixture error" } }, { status: 403 });
      },
    }).result();
    assert.equal(result.stopReason, "error");
    assert.equal(captured.headers.get("authorization"), "Bearer public");
    const messages = captured.body.messages ?? captured.body.input;
    const system = messages[0].content;
    assert.equal(typeof system === "string" ? system : system[0].text, "EXACT_PI_SYSTEM");
    assert.equal(captured.body.tool_choice, api === "openai-responses" ? "auto" : "none");
  }
});

test("cancelling a native streaming response reaches the transport and terminates the wrapper", async () => {
  const controller = new AbortController();
  let wireAborted = false;
  const wrapper = compatibleApi(openAICompletionsApi(), defs);
  const output = wrapper.streamSimple(model, {
    messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
  }, {
    signal: controller.signal, maxRetries: 0,
    fetch: async (_url, init) => new Response(new ReadableStream({
      start(stream) {
        const abort = () => { wireAborted = true; stream.error(new DOMException("cancelled", "AbortError")); };
        if (init?.signal?.aborted) { abort(); return; }
        init?.signal?.addEventListener("abort", abort, { once: true });
        stream.enqueue(new TextEncoder().encode('data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n'));
      },
    }), { headers: { "Content-Type": "text/event-stream" } }),
  });
  const events: string[] = [];
  for await (const event of output) {
    events.push(event.type);
    if (event.type === "text_delta") controller.abort();
  }
  assert.equal(wireAborted, true);
  assert.equal((await output.result()).stopReason, "aborted");
  assert.equal(events.includes("done"), false);
});
