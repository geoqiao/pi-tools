---
name: paseo-btw
description: Open a lightweight read-only side conversation in Paseo without interrupting the main task. Use when the user says "btw", "by the way", "顺便问一下", asks a side question, or wants a quick answer from Pi, Codex, or Claude in a separate subagent tab.
compatibility: Requires Paseo orchestration tools or the paseo CLI in a Paseo-managed agent.
user-invocable: true
argument-hint: "[config ...] | [--model <inherit|provider/model>] [--context <inherit|summary|none>] <side question>"
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
config context inherit|summary|none
config context-tail 40
config context-max-chars 8000
config reset
```

Run the matching script command and report the resulting configuration. Invocation flags override
persisted defaults for that invocation only:

- `config context-tail N` maps to `config.mjs set contextTail N`
- `config context-max-chars N` maps to `config.mjs set contextMaxChars N`

- `--model <inherit|provider/model>`
- `--context <inherit|summary|none>`
- `--profile <name>` remains an explicit model/settings override
- `--provider pi|codex|claude` remains a provider-family override

## Semantics

- The BTW agent answers a side question. It does not take over the parent task.
- It is read-only by default: no file edits, commits, configuration changes, destructive commands,
  or external write actions.
- It shares the parent's current Paseo workspace. Do not create a worktree or a new workspace.
- By default it inherits the parent's exact Paseo provider/model and thinking setting.
- By default it receives a bounded, best-effort redacted mechanical snapshot of the parent's Paseo
  text timeline.
- Launch asynchronously. The user can continue the parent conversation immediately.
- The child appears in Paseo's Subagents track and notifies the parent when it finishes.
- One BTW invocation creates one child. Follow-up discussion should continue in that child tab or
  use `send_agent_prompt` with its agent ID instead of creating another child.

## Parse the request

Recognize these optional selectors:

- `--profile <name>`: use that exact configured Paseo profile.
- `--provider pi|codex|claude`: choose an available model from that provider.
- `--model <inherit|provider/model>`: override the configured model for this invocation.
- `--context <inherit|summary|none>`: override context inheritance for this invocation.
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
   `<parent-provider>/<parent-model>`, and copy the parent's thinking option, current mode, and
   feature values when present. Convert each parent feature `{ id, value }` into the
   `settings.features` object. For example, parent provider `pi` plus model
   `openai-codex/gpt-5.6-sol` becomes
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

Paseo's current public MCP and CLI surfaces do not expose the app's fork-context attachment
operation. The app's own **Fork chat from here** experience creates a new agent with mechanically
curated text history rather than cloning a provider-native session. `context: inherit` follows the
same design using the documented `paseo logs` CLI.

When context is `inherit`, run the packaged capture helper with the persisted `contextTail` and
`contextMaxChars` values:

```bash
node <skill-directory>/scripts/context.mjs \
  --agent-id "$PASEO_AGENT_ID" \
  --source-directory "<parent cwd from get_agent_status>" \
  --tail <contextTail> \
  --max-chars <contextMaxChars>
```

The helper requests only Paseo's text timeline, removes reasoning blocks and the current user turn,
strips terminal escapes, applies best-effort secret redaction, bounds the result, and emits a
`<chat-history-summary>` block. Put that block first in the child prompt, followed by:

```markdown
## Side question
[The user's question verbatim.]

## Response contract
- Answer the side question directly and concisely.
- State uncertainty explicitly.
- Do not edit, create, move, or delete files.
- Do not change configuration, commit, publish, or perform external write actions.
- Do not continue the parent's main task.
```

If capture fails or returns no earlier context, state the fallback briefly and use `summary` for
that invocation. Never insert raw, unsanitized `paseo logs` output into a child prompt.

When context is `summary`, prepare a concise semantic snapshot under `## Relevant context`. Include
only the objective, decisions, errors, recent intent, and necessary file paths. Omit unrelated
history, credentials, and large tool outputs; label it as a static snapshot.

When context is `none`, omit the `Relevant context` section entirely and send only the side
question plus the response contract.

Provider-native transcript cloning is intentionally not implemented yet. In particular, do not
switch the child Pi runtime's session, call private Paseo WebSocket operations, or rewrite native
Claude/Codex session files.

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
