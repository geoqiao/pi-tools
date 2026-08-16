# @geoqiao/paseo-btw

Portable Pi commands and [Agent Skills](https://agentskills.io/) for orchestrating coding agents
through [Paseo](https://paseo.sh/).

## Included tools

### `/btw` and `paseo-btw`

Starts a lightweight side conversation without interrupting the main task.
The side agent runs in the same Paseo workspace and appears in the Subagents track.

In Paseo's Pi provider, use the native extension command:

```text
/btw why might this API return 409?
```

The extension also registers the collision-free alias `/paseo-btw`. If another installed extension
already owns `/btw`, Pi assigns numeric suffixes; use `/paseo-btw` or remove the conflicting package.

`/btw` is handled before Pi starts an LLM turn. A packaged Node CLI reads the parent settings,
captures inherited context when enabled, and calls `paseo run --background` directly. The text
after `/btw` is passed unchanged as the side question, so the parent transcript gets no reasoning
or tool-call loop.

The Agent Skill remains a compatibility fallback for Codex, Claude Code, and clients that cannot
load Pi extensions. It necessarily uses one parent model turn:

```text
/skill:paseo-btw why might this API return 409?
/skill:paseo-btw --provider claude sanity-check this UX decision
/skill:paseo-btw --profile 低成本精修 explain this stack trace
```

When the Pi extension is loaded, it intercepts `/skill:paseo-btw ...` before Skill expansion and
routes it through the same zero-parent-turn CLI. The model-mediated behavior above applies only to
hosts that cannot load the extension.

The native command inherits the parent's Paseo provider/model and thinking setting plus a bounded
mechanical snapshot of the parent's Paseo text timeline by default. The model-mediated Skill can
also copy mode and feature values. Configure persistent defaults with:

```text
/btw-config
/btw-config model inherit
/btw-config model claude/claude-haiku-4-5
/btw-config context inherit
/btw-config context none
/btw-config context-tail 40
/btw-config context-max-chars 8000
/btw-config reset
```

`context: inherit` uses documented `paseo logs` output after removing the current turn, applying
best-effort secret redaction, and enforcing a size limit. `context: none` sends only the text after
`/btw`. The legacy `summary` mode is available only through the model-mediated Agent Skill because
creating a semantic summary requires a parent model turn. If mechanical capture is unavailable,
the native command still launches with the side question alone and reports the fallback.

Paseo's app-level **Fork chat from here** also injects mechanically curated text into a new agent;
it is not a provider-native session clone. Native Pi session forking remains a future opt-in mode
and is deliberately not claimed by this release.

Claude Code and Codex may expose the fallback Skill as `/paseo-btw` instead of Pi's
`/skill:paseo-btw` form. They cannot provide Pi's zero-parent-turn extension command.

## Prerequisite

Enable Paseo orchestration tools under **Settings → your host → Agents → Enable Paseo tools**,
then start a new agent or reload the current one. The skill prefers Paseo's injected tools and
falls back to the `paseo` CLI when those tools are unavailable.

## Installation

### Pi package

After publication:

```bash
pi install npm:@geoqiao/paseo-btw
```

### Claude Code, Codex, and other Agent Skills clients

Install from the Git repository with the standard skills installer:

```bash
npx skills add geoqiao/pi-tools --skill paseo-btw --agent '*' -g
```

During local development:

```bash
npx skills add /absolute/path/to/pi-tools/packages/paseo-btw --skill paseo-btw --agent '*' -g
```

The npm package intentionally has no install-time script that mutates a user's agent
configuration. npm distributes the files; Pi reads the `pi.extensions` and `pi.skills` manifests,
while other harnesses use the Agent Skills installer.

## Development

```bash
npm test
npm run pack:check
npx skills add . --list
```

This package is developed in the `pi-tools` monorepo and is published independently from the
other workspace packages.
