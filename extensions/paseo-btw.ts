import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const launcher = fileURLToPath(new URL("../bin/paseo-btw.mjs", import.meta.url));
const configScript = fileURLToPath(
  new URL("../skills/paseo-btw/scripts/config.mjs", import.meta.url),
);

export default function paseoBtwExtension(pi: ExtensionAPI) {
  const btwCommand = {
    description: "Open a Paseo side conversation without running the parent model",
    handler: async (args, ctx) => {
      const prompt = args.trim();
      if (!prompt) {
        ctx.ui.notify("Usage: /btw <side question>", "warning");
        return;
      }

      const parentAgentId = process.env.PASEO_AGENT_ID?.trim();
      if (!parentAgentId) {
        ctx.ui.notify("/btw requires a Paseo-managed Pi agent", "error");
        return;
      }

      try {
        const { stdout } = await execFileAsync(
          process.execPath,
          [launcher, "--parent-agent-id", parentAgentId, "--cwd", ctx.cwd, "--prompt", prompt],
          {
            encoding: "utf8",
            maxBuffer: 1_000_000,
            timeout: 45_000,
          },
        );
        const result = JSON.parse(stdout) as {
          agentId: string;
          title: string;
          warning?: string;
        };
        const warning = result.warning ? `\n${result.warning}` : "";
        ctx.ui.notify(`Started ${result.title}\n${result.agentId}${warning}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`BTW failed: ${message}`, "error");
      }
    },
  } satisfies Parameters<ExtensionAPI["registerCommand"]>[1];

  pi.registerCommand("btw", btwCommand);
  pi.registerCommand("paseo-btw", btwCommand);

  pi.registerCommand("btw-config", {
    description: "Show or change BTW defaults without running the parent model",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/u).filter(Boolean);
      let command: string[];
      if (parts.length === 0 || parts[0] === "show") command = ["show"];
      else if (parts[0] === "reset" && parts.length === 1) command = ["reset"];
      else if (parts.length === 2) {
        const field =
          parts[0] === "context-tail"
            ? "contextTail"
            : parts[0] === "context-max-chars"
              ? "contextMaxChars"
              : parts[0];
        command = ["set", field, parts[1]];
      } else {
        ctx.ui.notify(
          "Usage: /btw-config [show|reset|model VALUE|context VALUE|context-tail N|context-max-chars N]",
          "warning",
        );
        return;
      }

      try {
        const { stdout } = await execFileAsync(process.execPath, [configScript, ...command], {
          encoding: "utf8",
          maxBuffer: 100_000,
          timeout: 10_000,
        });
        const config = JSON.parse(stdout) as Record<string, unknown>;
        ctx.ui.notify(
          `BTW config: model=${config.model}, context=${config.context}, contextTail=${config.contextTail}, contextMaxChars=${config.contextMaxChars}`,
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`BTW config failed: ${message}`, "error");
      }
    },
  });
}
