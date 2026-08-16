import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
});
