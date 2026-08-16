import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

const execFileAsync = promisify(execFile);

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const skill = await readFile(
  new URL("../skills/paseo-btw/SKILL.md", import.meta.url),
  "utf8",
);

test("publishes paseo-btw through the Pi package manifest", () => {
  assert.equal(packageJson.name, "@geoqiao/pi-tools");
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  assert.ok(packageJson.keywords.includes("pi-package"));
  assert.ok(packageJson.files.includes("skills"));
});

test("skill has portable Agent Skills frontmatter", () => {
  assert.match(skill, /^---\n[\s\S]*\n---\n/);
  assert.match(skill, /\nname: paseo-btw\n/);
  assert.match(skill, /\ndescription: .+\n/);
  assert.match(skill, /\ncompatibility: .+\n/);
});

test("BTW flow is asynchronous, read-only, and same-workspace", () => {
  assert.match(skill, /notifyOnFinish: true/);
  assert.match(skill, /Do not wait, poll/);
  assert.match(skill, /no `workspaceId`/);
  assert.match(skill, /Do not edit, create, move, or delete files/);
  assert.match(skill, /\{ "kind": "btw" \}/);
  assert.match(skill, /list_profiles/);
  assert.match(skill, /create_agent/);
  assert.match(skill, /PASEO_AGENT_ID/);
  assert.match(skill, /get_agent_status/);
  assert.match(skill, /portable semantic snapshot/);
});

test("configuration defaults to inheriting model and context", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-tools-test-"));
  try {
    const script = fileURLToPath(
      new URL("../skills/paseo-btw/scripts/config.mjs", import.meta.url),
    );
    const env = { ...process.env, PI_TOOLS_CONFIG_HOME: root };

    const initial = JSON.parse((await execFileAsync(process.execPath, [script, "show"], { env })).stdout);
    assert.equal(initial.model, "inherit");
    assert.equal(initial.context, "inherit");

    const changed = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [script, "set", "model", "claude/claude-haiku-4-5"],
          { env },
        )
      ).stdout,
    );
    assert.equal(changed.model, "claude/claude-haiku-4-5");

    const noContext = JSON.parse(
      (
        await execFileAsync(
          process.execPath,
          [script, "set", "context", "none"],
          { env },
        )
      ).stdout,
    );
    assert.equal(noContext.context, "none");

    const reset = JSON.parse(
      (await execFileAsync(process.execPath, [script, "reset"], { env })).stdout,
    );
    assert.equal(reset.model, "inherit");
    assert.equal(reset.context, "inherit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
