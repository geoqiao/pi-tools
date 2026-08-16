---
name: paseo-btw
description: Open a lightweight read-only side conversation in Paseo without interrupting the main task. Use when the user says "btw", "by the way", "顺便问一下", asks a side question, or wants a quick answer from Pi, Codex, or Claude in a separate subagent tab.
compatibility: Requires Paseo orchestration tools or the paseo CLI in a Paseo-managed agent.
user-invocable: true
argument-hint: "[--profile <name> | --provider <pi|codex|claude>] <side question>"
---

# Paseo BTW

Create a small side conversation while the parent keeps its current task and context intact.

**User's request:** $ARGUMENTS

## Semantics

- The BTW agent answers a side question. It does not take over the parent task.
- It is read-only by default: no file edits, commits, configuration changes, destructive commands,
  or external write actions.
- It shares the parent's current Paseo workspace. Do not create a worktree or a new workspace.
- Launch asynchronously. The user can continue the parent conversation immediately.
- The child appears in Paseo's Subagents track and notifies the parent when it finishes.
- One BTW invocation creates one child. Follow-up discussion should continue in that child tab or
  use `send_agent_prompt` with its agent ID instead of creating another child.

## Parse the request

Recognize these optional selectors:

- `--profile <name>`: use that exact configured Paseo profile.
- `--provider pi|codex|claude`: choose an available model from that provider.
- Everything else is the side question. If the question is empty, ask the user for it instead of
  launching an agent.

## Choose the agent

Prefer Paseo's injected MCP tools.

1. Call `list_profiles` and read every profile's notes.
2. If the user named a profile, materialize that profile exactly.
3. If the user named a provider, prefer a matching configured profile. If none exists, call
   `inspect_provider` and `list_models`; select an available fast or cost-efficient model suitable
   for a short read-only answer. Never guess model or mode IDs.
4. Otherwise choose the profile whose notes best match a small, bounded investigation. Prefer a
   fast or cost-efficient profile over an architecture or implementation profile.

When using a profile, materialize it explicitly:

- combine `provider` and `model` as the `create_agent.provider` value
- copy `modeId` to `settings.modeId`
- copy `thinkingOptionId` to `settings.thinkingOptionId`
- copy `featureValues` to `settings.features`
- omit fields the profile does not define

## Build the briefing

The child has no parent transcript. Give it only the minimum useful context:

```markdown
## Side question
[The user's question verbatim.]

## Relevant context
[A concise summary of facts from the parent conversation that are necessary to answer. Omit the
main task's unrelated history. Include relevant file paths, but do not paste large files.]

## Response contract
- Answer the side question directly and concisely.
- State uncertainty explicitly.
- Do not edit, create, move, or delete files.
- Do not change configuration, commit, publish, or perform external write actions.
- Do not continue the parent's main task.
```

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
