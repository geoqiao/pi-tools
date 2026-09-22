import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BASE_URL, buildCatalog, METADATA_URL, parseSnapshot, type CatalogSnapshot } from "./catalog.ts";

export const CACHE_TTL_MS = 60 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 12_000;

export function fresh(snapshot: CatalogSnapshot | undefined, now = Date.now()): boolean {
  return !!snapshot && now >= snapshot.checkedAt && now - snapshot.checkedAt < CACHE_TTL_MS;
}

export function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** One bounded metadata fetch per provider instance; one caller's abort cannot cancel another. */
export function createDiscovery(cachePath: string, fetcher: typeof fetch = fetch) {
  let pending: Promise<CatalogSnapshot> | undefined;
  let writes = Promise.resolve();
  return {
    async load(): Promise<CatalogSnapshot | undefined> {
      try { return parseSnapshot(JSON.parse(await readFile(cachePath, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
        throw error;
      }
    },
    fetch(signal?: AbortSignal): Promise<CatalogSnapshot> {
      if (!pending) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("Model discovery timed out.")), FETCH_TIMEOUT_MS);
        const get = async (url: string) => {
          const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Model discovery: ${new URL(url).hostname} returned HTTP ${response.status}.`);
          return response.json() as Promise<unknown>;
        };
        pending = Promise.all([get(BASE_URL + "/models"), get(METADATA_URL)])
          .then(([zen, metadata]) => buildCatalog(zen, metadata))
          .finally(() => { clearTimeout(timer); controller.abort(); pending = undefined; });
      }
      return waitFor(pending, signal);
    },
    save(snapshot: CatalogSnapshot): Promise<void> {
      // Serialize local writes and use atomic rename, so interrupted writes cannot corrupt the cache.
      const task = writes.catch(() => {}).then(async () => {
        await mkdir(dirname(cachePath), { recursive: true });
        const current = await readFile(cachePath, "utf8").then(s => parseSnapshot(JSON.parse(s))).catch(() => undefined);
        if (current && current.checkedAt > snapshot.checkedAt) return;
        const temp = `${cachePath}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600, flag: "wx" });
          await rename(temp, cachePath);
        } finally { await unlink(temp).catch(() => {}); }
      });
      writes = task;
      return task;
    },
  };
}
