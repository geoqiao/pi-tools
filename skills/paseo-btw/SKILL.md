---
name: paseo-btw
description: Open a lightweight read-only side conversation in Paseo without interrupting the main task. Use when the user says "btw", "by the way", "顺便问一下", asks a side question, or wants a quick answer from Pi, Codex, or Claude in a separate subagent tab.
compatibility: Requires Paseo orchestration tools or the paseo CLI in a Paseo-managed agent.
user-invocable: true
argument-hint: "[config ...] | [--model <inherit|provider/model>] [--context <inherit|none>] <side question>"
---

# Paseo BTW

Create a small side conversation while the parent keeps its current task and context intact.

**User's request:** $ARGUMENTS

## Defaults and configuration

Defaults are `model: inherit` and `context: inherit`. Read the persisted configuration before
launching:

```bash
node <skill-directory>/scripts/config.mjs show
```

Handle configuration requests without launching an agent:

```text
config
config model inherit
config model pi/openai-codex/gpt-5.6-sol
config model codex/gpt-5.4-mini
config model claude/claude-haiku-4-5
config context inherit|none
config reset
```

Run the matching script command and report the resulting configuration. Invocation flags override
persisted defaults for that invocation only:

- `--model <inherit|provider/model>`
- `--context <inherit|none>`
- `--profile <name>` remains an explicit model/settings override
- `--provider pi|codex|claude` remains a provider-family override

## Semantics

- The BTW agent answers a side question. It does not take over the parent task.
- It is read-only by default: no file edits, commits, configuration changes, destructive commands,
  or external write actions.
- It shares the parent's current Paseo workspace. Do not create a worktree or a new workspace.
- By default it inherits the parent's exact Paseo provider/model and thinking setting.
- By default it receives a portable snapshot of relevant parent conversation context.
- Launch asynchronously. The user can continue the parent conversation immediately.
- The child appears in Paseo's Subagents track and notifies the parent when it finishes.
- One BTW invocation creates one child. Follow-up discussion should continue in that child tab or
  use `send_agent_prompt` with its agent ID instead of creating another child.

## Parse the request

Recognize these optional selectors:

- `--profile <name>`: use that exact configured Paseo profile.
- `--provider pi|codex|claude`: choose an available model from that provider.
- `--model <inherit|provider/model>`: override the configured model for this invocation.
- `--context <inherit|none>`: override context inheritance for this invocation.
- Everything else is the side question. If the question is empty, ask the user for it instead of
  launching an agent.

`--profile`, `--provider`, and `--model` are mutually exclusive model selectors. If more than one
is present, ask the user to choose one rather than guessing precedence. A one-off selector replaces
the persisted `model` setting for that invocation.

## Choose the agent

Prefer Paseo's injected MCP tools.

1. If the user named a profile, call `list_profiles`, read every profile's notes, and materialize
   that profile exactly.
2. If the user named a provider, prefer a matching configured profile. If none exists, call
   `inspect_provider` and `list_models`; select an available fast or cost-efficient model suitable
   for a short read-only answer. Never guess model or mode IDs.
3. Otherwise, when the effective model is `inherit`, read `PASEO_AGENT_ID` from the environment and call
   `get_agent_status` for that exact parent. Build the child provider as
   `<parent-provider>/<parent-model>`, and copy the parent's thinking option and current mode when
   present. For example, parent provider `pi` plus model `openai-codex/gpt-5.6-sol` becomes
   `pi/openai-codex/gpt-5.6-sol`. If the parent identity or model cannot be resolved, explain the
   fallback and continue with profile selection.
4. If the effective model is an explicit `provider/model` value, validate it against
   `inspect_provider` and `list_models` before use. Paseo Pi models may contain another slash, such
   as `pi/openai-codex/gpt-5.6-sol`.
5. Only when inheritance failed and no override was supplied, choose the profile whose notes best
   match a small, bounded investigation. Prefer a fast or cost-efficient profile over an
   architecture or implementation profile.

When using a profile, materialize it explicitly:

- combine `provider` and `model` as the `create_agent.provider` value
- copy `modeId` to `settings.modeId`
- copy `thinkingOptionId` to `settings.thinkingOptionId`
- copy `featureValues` to `settings.features`
- omit fields the profile does not define

## Build the briefing

Paseo does not currently expose a native clone/fork-context option on `create_agent`. Therefore
`context: inherit` means a portable semantic snapshot, not the provider-native transcript replay
or prompt-cache inheritance offered by `pi-herdr-btw`.

When context is `inherit`, give the child the minimum useful snapshot from the parent conversation:

```markdown
## Side question
[The user's question verbatim.]

## Relevant context
[Current objective, relevant decisions, errors, recent user intent, and file paths needed to answer.
Omit unrelated history, secrets, credentials, and large tool outputs. Clearly label this as a
static snapshot that will not receive later parent updates.]

## Response contract
- Answer the side question directly and concisely.
- State uncertainty explicitly.
- Do not edit, create, move, or delete files.
- Do not change configuration, commit, publish, or perform external write actions.
- Do not continue the parent's main task.
```

When context is `none`, omit the `Relevant context` section entirely and send only the side
question plus the response contract.

## Launch

Call `create_agent` with:

- title: `[BTW] <short topic>`
- initial prompt: the self-contained briefing above
- selected provider/profile settings
- `notifyOnFinish: true`
- labels object `{ "kind": "btw" }` when labels are supported
- no `workspaceId`, so Paseo keeps the child in the parent's workspace and ownership tree

Do not wait, poll, or repeatedly call status tools. Report the returned agent ID and tell the user
that the side conversation is available in the Subagents track.

## CLI fallback

Use this only when Paseo tools are unavailable and `paseo` is on PATH:

```bash
paseo run --background --title "[BTW] <short topic>" --label kind=btw --provider <provider/model> "<briefing>"
```

Inside a Paseo-managed agent, `PASEO_AGENT_ID` preserves parentage and the current workspace.
Discover provider/model identifiers first; do not invent them. If neither MCP tools nor the CLI is
available, explain the prerequisite and do not simulate a side agent in the parent conversation.
