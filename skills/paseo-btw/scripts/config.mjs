#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULTS = Object.freeze({ model: "inherit", context: "inherit" });

function configPath() {
  const root =
    process.env.PI_TOOLS_CONFIG_HOME ??
    process.env.XDG_CONFIG_HOME ??
    join(homedir(), ".config");
  return join(root, "pi-tools", "btw.json");
}

function validateModel(value) {
  if (value === "inherit") return value;
  if (typeof value !== "string" || !/^[^/\s]+\/.+/.test(value)) {
    throw new Error("model must be 'inherit' or a Paseo provider/model value");
  }
  return value;
}

function validateContext(value) {
  if (value !== "inherit" && value !== "none") {
    throw new Error("context must be 'inherit' or 'none'");
  }
  return value;
}

function normalize(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BTW configuration must be a JSON object");
  }
  return {
    model: validateModel(value.model ?? DEFAULTS.model),
    context: validateContext(value.context ?? DEFAULTS.context),
  };
}

async function readConfig() {
  try {
    return normalize(JSON.parse(await readFile(configPath(), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return { ...DEFAULTS };
    throw error;
  }
}

async function writeConfig(config) {
  const target = configPath();
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(normalize(config), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, target);
    await chmod(target, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return normalize(config);
}

function print(config) {
  process.stdout.write(`${JSON.stringify({ path: configPath(), ...config }, null, 2)}\n`);
}

async function main() {
  const [command = "show", field, value, extra] = process.argv.slice(2);
  if (extra !== undefined) throw new Error("too many arguments");

  if (command === "show" && field === undefined) {
    print(await readConfig());
    return;
  }
  if (command === "reset" && field === undefined) {
    print(await writeConfig(DEFAULTS));
    return;
  }
  if (command !== "set" || !field || value === undefined) {
    throw new Error("usage: config.mjs show | reset | set model <value> | set context <value>");
  }

  const current = await readConfig();
  if (field === "model") current.model = validateModel(value);
  else if (field === "context") current.context = validateContext(value);
  else throw new Error("field must be 'model' or 'context'");
  print(await writeConfig(current));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
