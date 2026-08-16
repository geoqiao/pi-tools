#!/usr/bin/env node

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const configScript = fileURLToPath(
  new URL("../skills/paseo-btw/scripts/config.mjs", import.meta.url),
);
const contextScript = fileURLToPath(
  new URL("../skills/paseo-btw/scripts/context.mjs", import.meta.url),
);

function parseArgs(argv) {
  const options = {
    parentAgentId: process.env.PASEO_AGENT_ID?.trim(),
    cwd: process.cwd(),
    paseoBin: process.env.PASEO_CLI?.trim() || "paseo",
    prompt: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--") {
      options.prompt = argv.slice(index + 1).join(" ");
      break;
    }
    if (!value) throw new Error(`missing value for ${flag}`);
    if (flag === "--parent-agent-id") options.parentAgentId = value.trim();
    else if (flag === "--cwd") options.cwd = value;
    else if (flag === "--paseo-bin") options.paseoBin = value;
    else if (flag === "--prompt") options.prompt = value;
    else throw new Error(`unknown option: ${flag}`);
    index += 1;
  }

  if (!options.parentAgentId) {
    throw new Error("PASEO_AGENT_ID or --parent-agent-id is required");
  }
  if (!options.cwd || /[\u0000-\u001F\u007F]/u.test(options.cwd)) {
    throw new Error("cwd must be a non-empty single-line path");
  }
  options.prompt = options.prompt?.trim();
  if (!options.prompt) throw new Error("usage: paseo-btw -- <side question>");
  return options;
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 2_000_000,
    timeout: 30_000,
    ...options,
  });
}

async function readConfig() {
  const { stdout } = await run(process.execPath, [configScript, "show"]);
  return JSON.parse(stdout);
}

async function inspectParent(options) {
  const { stdout } = await run(options.paseoBin, [
    "inspect",
    options.parentAgentId,
    "--json",
  ]);
  const parent = JSON.parse(stdout);
  const provider = String(parent.Provider ?? parent.provider ?? "").trim();
  const model = String(parent.Model ?? parent.model ?? "").trim();
  if (!provider || !model) throw new Error("Paseo parent provider/model is unavailable");
  const activeMode = String(parent.Mode ?? parent.mode ?? "").trim();
  const availableModes = parent.AvailableModes ?? parent.availableModes;
  const mode = Array.isArray(availableModes)
    ? availableModes.some((item) =>
        typeof item === "string"
          ? item === activeMode
          : item && typeof item === "object" && (item.id === activeMode || item.Id === activeMode),
      )
      ? activeMode
      : ""
    : "";
  return {
    provider: `${provider}/${model}`,
    thinking: String(parent.Thinking ?? parent.thinking ?? "").trim(),
    mode,
  };
}

async function captureInheritedContext(options, config) {
  if (config.context === "none") return { text: "", mode: "none" };
  if (config.context === "summary") {
    return {
      text: "",
      mode: "none",
      warning: "context=summary requires a parent model turn; /btw sent no parent context",
    };
  }
  try {
    const { stdout } = await run(process.execPath, [
      contextScript,
      "--agent-id",
      options.parentAgentId,
      "--source-directory",
      options.cwd,
      "--tail",
      String(config.contextTail),
      "--max-chars",
      String(config.contextMaxChars),
      "--paseo-bin",
      options.paseoBin,
    ]);
    return { text: stdout.trim(), mode: "inherit" };
  } catch (error) {
    return {
      text: "",
      mode: "none",
      warning: `context capture failed; sent only the side question: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildTitle(prompt) {
  const compact = prompt.replace(/\s+/gu, " ").trim();
  const topic = compact.length > 48 ? `${compact.slice(0, 47)}…` : compact;
  return `[BTW] ${topic}`;
}

function findAgentId(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:agent_?id|id)$/iu.test(key) && typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }
  for (const item of Object.values(value)) {
    const nested = findAgentId(item);
    if (nested) return nested;
  }
  return undefined;
}

async function launch(options) {
  const [config, parent] = await Promise.all([readConfig(), inspectParent(options)]);
  const provider = config.model === "inherit" ? parent.provider : config.model;
  const context = await captureInheritedContext(options, config);
  const prompt = context.text ? `${context.text}\n\n${options.prompt}` : options.prompt;
  const title = buildTitle(options.prompt);
  const args = [
    "run",
    "--background",
    "--json",
    "--title",
    title,
    "--label",
    "kind=btw",
    "--provider",
    provider,
    "--cwd",
    options.cwd,
  ];
  if (config.model === "inherit" && parent.thinking) {
    args.push("--thinking", parent.thinking);
  }
  if (config.model === "inherit" && parent.mode) args.push("--mode", parent.mode);
  args.push(prompt);

  const { stdout } = await run(options.paseoBin, args, {
    cwd: options.cwd,
    env: { ...process.env, PASEO_AGENT_ID: options.parentAgentId },
  });
  const raw = JSON.parse(stdout);
  const agentId = findAgentId(raw);
  if (!agentId) throw new Error("Paseo created an agent but returned no agent ID");
  return {
    agentId,
    title,
    provider,
    context: context.mode,
    ...(context.warning ? { warning: context.warning } : {}),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(await launch(options))}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
