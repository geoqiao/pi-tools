import { join } from "node:path";
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  getAgentDir, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_ID } from "./catalog.ts";
import { createOpenCodeFreeProvider } from "./provider.ts";

export default async function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const instance = await createOpenCodeFreeProvider({
    cachePath: process.env.PI_OPENCODE_FREE_CACHE ?? join(getAgentDir(), "cache", "opencode-free.json"),
    offline: process.env.PI_OFFLINE !== undefined,
    disabledTools: [
      createReadToolDefinition(cwd), createBashToolDefinition(cwd),
      createEditToolDefinition(cwd), createWriteToolDefinition(cwd),
    ],
  });
  pi.registerProvider(instance.provider);
  pi.on("session_start", (_event, ctx) => {
    const warning = instance.warning();
    if (warning) ctx.ui.notify(`OpenCode Free: ${warning}`, "warning");
  });
  let refresh: Promise<unknown> | undefined;
  pi.registerCommand("opencode-free", {
    description: "OpenCode free model catalog: status or refresh (no inference probes)",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action !== "status" && action !== "refresh") {
        ctx.ui.notify("Usage: /opencode-free [status|refresh]", "warning");
        return;
      }
      if (action === "refresh") {
        refresh ??= ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true })
          .finally(() => { refresh = undefined; });
        await refresh;
      }
      ctx.ui.notify(instance.status(), instance.warning() ? "warning" : "info");
    },
  });
}
