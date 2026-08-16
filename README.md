# pi-tools

Monorepo for independently published Pi packages.

| Package | Purpose | Install |
|---|---|---|
| [`@geoqiao/pi-ask`](packages/pi-ask) | Structured `ask_user` flows for TUI and Pi RPC | `pi install npm:@geoqiao/pi-ask` |
| [`@geoqiao/paseo-btw`](packages/paseo-btw) | Zero-parent-turn Paseo side conversations for Pi, with an Agent Skill fallback | `pi install npm:@geoqiao/paseo-btw` |

The packages share this Git repository but keep separate npm names, versions, manifests,
documentation, tests, and release entries. Installing one does not install the other.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm pack:check
```

Run one package only:

```bash
pnpm --filter @geoqiao/pi-ask test
pnpm --filter @geoqiao/paseo-btw test
```

## Releases

Changesets versions and publishes each package independently:

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

The root workspace is private and is never published.
