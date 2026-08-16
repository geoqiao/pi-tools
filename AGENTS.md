# AGENTS.md

Guidance for agents working in this monorepo.

## Packages

- `packages/pi-ask` — `@geoqiao/pi-ask`; follow its package-local `AGENTS.md`.
- `packages/paseo-btw` — `@geoqiao/paseo-btw`; keep the Pi extension, CLI launcher, and portable Skill behavior aligned.

The packages are published independently. Do not introduce runtime coupling between them unless a
task explicitly requires it.

## Commands

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm pack:check
```

Use `pnpm --filter <package-name> <script>` for focused verification. Update package-local docs for
behavior changes and the root README only for workspace-level changes.

## Releases

Use Changesets for user-facing package changes. The root package is private and must never be
published.
