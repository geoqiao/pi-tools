# pi-tools

Portable [Agent Skills](https://agentskills.io/) for orchestrating coding agents through
[Paseo](https://paseo.sh/). The same skill source is intended to work from Pi, Codex, and
Claude Code sessions launched by Paseo.

## Included skills

### `paseo-btw`

Starts a lightweight, read-only side conversation without interrupting the main task. The side
agent runs in the same Paseo workspace, appears in the Subagents track, and reports back through
Paseo's normal completion notification.

Examples:

```text
/skill:paseo-btw why might this API return 409?
/skill:paseo-btw --provider claude sanity-check this UX decision
/skill:paseo-btw --profile 低成本精修 explain this stack trace
```

The child inherits the parent's Paseo provider/model, thinking setting, and a portable relevant
context snapshot by default. Configure persistent defaults with:

```text
/skill:paseo-btw config
/skill:paseo-btw config model inherit
/skill:paseo-btw config model claude/claude-haiku-4-5
/skill:paseo-btw config context inherit
/skill:paseo-btw config context none
/skill:paseo-btw config reset
```

One-off `--model` and `--context` flags override persisted defaults. Context inheritance is a
sanitized semantic snapshot prepared by the parent, not native provider transcript cloning or
prompt-cache reuse; Paseo's current `create_agent` API does not expose session cloning.

Claude Code and Codex may expose installed skills as `/paseo-btw` instead of Pi's
`/skill:paseo-btw` form.

## Prerequisite

Enable Paseo orchestration tools under **Settings → your host → Agents → Enable Paseo tools**,
then start a new agent or reload the current one. The skill prefers Paseo's injected tools and
falls back to the `paseo` CLI when those tools are unavailable.

## Installation

### Pi package

After publication:

```bash
pi install npm:@geoqiao/pi-tools
```

### Claude Code, Codex, and other Agent Skills clients

Install from the Git repository with the standard skills installer:

```bash
npx skills add geoqiao/pi-tools --skill paseo-btw --agent '*' -g
```

During local development:

```bash
npx skills add /absolute/path/to/pi-tools --skill paseo-btw --agent '*' -g
```

The npm package intentionally has no install-time script that mutates a user's agent
configuration. npm distributes the files; Pi reads the `pi.skills` manifest, while other
harnesses use the Agent Skills installer.

## Development

```bash
npm test
npm run pack:check
npx skills add . --list
```

This repository is designed as a collection: more portable skills can be added under `skills/`
without adding a runtime extension.
