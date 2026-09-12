# Docs

This folder keeps only the documentation needed to understand and maintain the extension without turning docs into a second copy of the code.

## Files

- `configuration.md` — source of truth for configuring pi-ask keymaps, behaviour, and `/answer` extraction
- `contract.md` — external behavior, tool payload/result details, and UX guarantees
- `remote-events.md` — local inter-extension event contract, bridge examples, and smoke-test steps
- `architecture.md` — module boundaries and invariants
- `../skills/ask-user/SKILL.md` — compact decision boundary and router; enabled by default, but can be disabled via `pi config`; inspired by https://github.com/edlsh/pi-ask-user
- `../skills/ask-user/references/interaction.md` — payload, TUI/RPC, and follow-up details
- `../skills/ask-user/references/decision-cases.md` — behavioral evaluation cases, not model test results

## Reading order

- read `configuration.md` for settings or keymap changes
- read `contract.md` for behavior
- read `remote-events.md` for local bridge/event integration
- read `architecture.md` for code layout

## Local test run

From repo root, run:

```bash
pnpm dev
pnpm dev ../some-target-folder
```

This starts pi in isolated mode, loads only this extension and bundled `ask-user` skill, and uses the optional folder as `--cd` target.

## Rule of thumb

If a detail is about implementation mechanics, it should usually live in `src/` or `tests/`, not here.
