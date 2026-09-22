import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { buildCatalog, BASE_URL, METADATA_URL, PROVIDER_ID } from "../src/catalog.ts";
import { CACHE_TTL_MS, createDiscovery } from "../src/discovery.ts";
import { createOpenCodeFreeProvider } from "../src/provider.ts";

const model = { name: "Free", cost: { input: 0, output: 0 }, reasoning: false, tool_call: true,
  modalities: { input: ["text"] }, limit: { context: 10000, output: 1000 } };
const zen = { data: [{ id: "free" }] };
const meta = { opencode: { npm: "@ai-sdk/openai-compatible", models: { free: model } } };
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "pi-free-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "catalog.json");
}
function responder(onRequest?: () => void): typeof fetch {
  return async url => { onRequest?.(); return Response.json(String(url) === METADATA_URL ? meta : zen); };
}

test("cold initialization awaits discovery; warm and offline starts avoid network", async t => {
  const cachePath = await fixture(t);
  let requests = 0;
  const fetcher = responder(() => requests++);
  const first = await createOpenCodeFreeProvider({ cachePath, disabledTools: [], fetch: fetcher });
  assert.equal(first.provider.getModels().length, 1);
  assert.equal(requests, 2);
  const second = await createOpenCodeFreeProvider({ cachePath, disabledTools: [], fetch: fetcher });
  assert.equal(second.provider.getModels().length, 1);
  assert.equal(requests, 2);
  const offline = await createOpenCodeFreeProvider({ cachePath, disabledTools: [], offline: true, fetch: fetcher });
  assert.equal(offline.provider.getModels().length, 1);
  const models = createModels();
  models.setProvider(first.provider);
  assert.equal((await models.getAvailable(PROVIDER_ID)).length, 1);
  assert.equal((await models.getAuth(PROVIDER_ID))?.auth.apiKey, "public");
});

test("network errors retain stale cache and remain visible", async t => {
  const cachePath = await fixture(t);
  const cached = buildCatalog(zen, meta, Date.now() - CACHE_TTL_MS - 1);
  await writeFile(cachePath, JSON.stringify(cached));
  const p = await createOpenCodeFreeProvider({
    cachePath, disabledTools: [], fetch: async () => new Response("down", { status: 503 }),
  });
  assert.equal(p.provider.getModels().length, 1);
  assert.match(p.status(), /HTTP 503/);
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).checkedAt, cached.checkedAt);
});

test("manual refresh publishes removals through Pi; paid transition never keeps static baseline", async t => {
  const cachePath = await fixture(t);
  let paid = false;
  const instance = await createOpenCodeFreeProvider({
    cachePath, disabledTools: [],
    fetch: async url => Response.json(String(url) === METADATA_URL
      ? { opencode: { ...meta.opencode, models: { free: { ...model, cost: { input: paid ? 1 : 0, output: 0 } } } } }
      : zen),
  });
  const models = createModels(); models.setProvider(instance.provider);
  paid = true;
  const result = await models.refresh({ providers: [PROVIDER_ID], force: true });
  assert.equal(result.errors.size, 0);
  assert.deepEqual(instance.provider.getModels(), []);
  assert.deepEqual(JSON.parse(await readFile(cachePath, "utf8")).models, []);
});

test("concurrent discovery shares requests and one caller's cancellation is isolated", async t => {
  const cachePath = await fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  const discovery = createDiscovery(cachePath, async url => {
    requests++; await gate; return Response.json(String(url) === METADATA_URL ? meta : zen);
  });
  const controller = new AbortController();
  const first = discovery.fetch(controller.signal);
  const second = discovery.fetch();
  controller.abort(new Error("cancel first"));
  await assert.rejects(first, /cancel first/);
  release();
  assert.equal((await second).models.length, 1);
  assert.equal(requests, 2);
});

test("Pi superseding a refresh cannot publish or persist the aborted generation", async t => {
  const cachePath = await fixture(t);
  await writeFile(cachePath, JSON.stringify(buildCatalog(zen, meta)));
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const instance = await createOpenCodeFreeProvider({
    cachePath, disabledTools: [], fetch: async url => {
      requests++; await gate; return Response.json(String(url) === METADATA_URL ? meta : zen);
    },
  });
  const models = createModels(); models.setProvider(instance.provider);
  const first = models.refresh({ providers: [PROVIDER_ID], force: true });
  // Wait for the first network request, without polling a remote service.
  while (requests === 0) await new Promise(resolve => setImmediate(resolve));
  const second = models.refresh({ providers: [PROVIDER_ID], force: true });
  release();
  await Promise.all([first, second]);
  assert.equal(requests, 2);
  assert.equal(instance.provider.getModels()[0].id, "free");
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).models[0].baseUrl, BASE_URL);
});

test("corrupt and absent offline caches do not synthesize a stale free allowlist", async t => {
  const cachePath = await fixture(t);
  await writeFile(cachePath, "{bad");
  const p = await createOpenCodeFreeProvider({
    cachePath, disabledTools: [], offline: true, fetch: async () => { throw new Error("unexpected fetch"); },
  });
  assert.deepEqual(p.provider.getModels(), []);
  assert.match(p.status(), /No cached models/);
});
