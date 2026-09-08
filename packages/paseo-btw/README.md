# Paseo BTW

[![npm version](https://img.shields.io/npm/v/@geoqiao/paseo-btw)](https://www.npmjs.com/package/@geoqiao/paseo-btw)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

**Ask a side question without interrupting the main task.**

`@geoqiao/paseo-btw` opens a lightweight conversation in the same [Paseo](https://paseo.sh/) workspace. The child appears in the **Subagents** track, while you continue working with the parent. In Paseo-managed Pi sessions, the native `/btw` command launches it without a parent LLM turn.

```text
/btw why might this API return 409?
```

[Quick start](#quick-start) · [Native command or Skill](#native-command-or-skill) · [Defaults](#defaults-and-configuration) · [Context and limits](#context-and-limits)

## Quick start

### Prerequisites

Run inside a **Paseo-managed agent**. Native Pi commands require the `paseo` CLI to be available; they use the parent identity supplied by Paseo through `PASEO_AGENT_ID`.

For the portable Skill, enable orchestration tools under **Settings → your host → Agents → Enable Paseo tools**, then start a new agent or reload the current one. The Skill prefers injected Paseo tools and falls back to the CLI when unavailable.

### Pi

```bash
pi install npm:@geoqiao/paseo-btw
```

Run `/reload` in an already-open Pi session, then ask your side question:

```text
/btw explain this stack trace
```

The extension also registers `/paseo-btw`. If another extension owns `/btw`, Pi assigns numeric suffixes; use `/paseo-btw` to avoid that collision.

### Claude Code, Codex, and other Agent Skills clients

Install the portable [Agent Skill](https://agentskills.io/) from the repository:

```bash
npx skills add geoqiao/pi-tools --skill paseo-btw --agent '*' -g
```

Invoke the installed `paseo-btw` Skill using your client's command syntax. Claude Code and Codex may expose `/paseo-btw`; Pi uses `/skill:paseo-btw`. These clients still need a Paseo-managed session and orchestration access—the Skill is not a standalone agent service.

The npm package has no install-time script that edits agent configuration. Pi reads its extension and skill manifests; other clients use the skills installer.

## Native command or Skill?

| Capability | Native Pi extension | Model-mediated Skill fallback |
|---|---|---|
| Entry point | `/btw` or `/paseo-btw` | Installed Skill command in the host client |
| Parent model turn | None; the extension calls the launcher directly | One orchestration turn |
| Defaults | Inherits parent provider/model, thinking setting, and bounded text context | Same defaults; can also copy mode and feature values |
| Configuration | `/btw-config` | Skill `config` requests |
| One-off model selectors | Not parsed from the side question; use `/btw-config` | Supports `--model`, `--provider`, and `--profile` |
| Context | `inherit` or `none` | `inherit`, semantic `summary`, or `none` |

**When the Pi extension is loaded, it also intercepts `/skill:paseo-btw` before Skill expansion.** That path behaves like the native command, not the model-mediated fallback. Text after the command is forwarded as the side question rather than parsed as Skill flags.

For hosts actually using the model-mediated Skill, examples in Pi-style notation are:

```text
/skill:paseo-btw why might this API return 409?
/skill:paseo-btw --provider claude sanity-check this UX decision
/skill:paseo-btw --profile 低成本精修 explain this stack trace
```

Use your host's equivalent invocation syntax. Continue follow-up discussion in the existing child tab rather than starting a new child for every message.

## Defaults and configuration

The native command inherits the parent's model and context unless configured otherwise. View current settings without launching a side agent:

```text
/btw-config
```

| Setting | Default | Example |
|---|---|---|
| Model | `inherit` | `/btw-config model claude/claude-haiku-4-5` |
| Context | `inherit` | `/btw-config context none` |
| Timeline tail (`paseo logs --tail`) | `40` | `/btw-config context-tail 40` |
| Context limit | `8000` characters | `/btw-config context-max-chars 8000` |

Explicit model values use Paseo's `provider/model` format; Pi model IDs can contain another slash, such as `pi/openai-codex/<model-id>`. Choose a model available in your Paseo setup. Restore inheritance or reset all defaults with:

```text
/btw-config model inherit
/btw-config context inherit
/btw-config reset
```

Settings normally live in `~/.config/pi-tools/btw.json`. `PI_TOOLS_CONFIG_HOME`, then `XDG_CONFIG_HOME`, can override the config root. The portable Skill uses the same persisted settings through its `config` requests; one-off Skill selectors override them for that invocation only.

## Context and limits

| Mode | What the child receives |
|---|---|
| `inherit` | A bounded mechanical snapshot of the parent's Paseo text timeline plus the side question |
| `none` | The side question without parent history |
| `summary` | A semantic summary prepared by the parent model; available only through the model-mediated Skill |

Mechanical capture uses documented `paseo logs` output, removes the current turn and reasoning blocks, strips terminal escapes, applies best-effort secret redaction, and enforces the configured size limit. **Redaction is not a guarantee that all sensitive information is removed.** Inherited text is sent to the child agent and its selected provider; use `context none` when you do not want to forward parent history.

If native capture fails, the side conversation still launches with only the question and reports the fallback. If `summary` was saved through the Skill, the native command sends no parent context and warns that semantic summarization requires a model turn. The model-mediated Skill may instead fall back from failed capture to a semantic summary.

This is **not a provider-native session clone**. Paseo's app-level **Fork chat from here** also curates text for a new agent; native Pi session forking is not implemented by this package.

The side conversation shares the parent's workspace; it does not create a worktree or an isolated sandbox. The portable Skill instructs the child to stay read-only and not take over the main task, but that is guidance, not permission enforcement. The native launcher forwards the question without adding the Skill's read-only response contract. Do not rely on either entry point as a security boundary. Pi's `/skill:paseo-btw` interception cannot forward image attachments through the CLI.

<details>
<summary>How native launch works</summary>

Pi handles the extension command before starting an LLM turn. A packaged Node CLI reads persistent defaults, inspects the parent agent, captures context when enabled, and calls `paseo run --background`. It forwards the side question unchanged after trimming; no parent reasoning or tool-call loop is needed.

The child stays in the current Paseo workspace through the inherited parent identity. With model inheritance enabled, the launcher copies the parent's thinking setting and a mode when it can validate that mode against the parent's available modes. It does not promise a complete copy of every provider feature or native session state.

See the [portable Skill](skills/paseo-btw/SKILL.md) for model-mediated launch, selector handling, context rules, and CLI fallback behavior.

</details>

## Development

From the monorepo root:

```bash
pnpm --filter @geoqiao/paseo-btw test
pnpm --filter @geoqiao/paseo-btw pack:check
```

To install the local Skill into supported clients:

```bash
npx skills add ./packages/paseo-btw --skill paseo-btw --agent '*' -g
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for workspace setup and Changesets. This package is published independently from the other workspace packages.

## License

[MIT](LICENSE).
