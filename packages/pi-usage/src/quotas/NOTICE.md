# Quota integration attribution

The quota schema, registry, cache, CLI protocol, and provider parsing logic are adapted from **Vibe Usage** `@vibe-cafe/vibe-usage` package version `0.11.1`, upstream commit `4a4dcc09f1510c7c732525a9e736068c60ff2a36`:

<https://github.com/vibe-cafe/vibe-usage>

The adapted upstream files are listed in `upstream-files.json` with SHA-256 hashes for the pinned source and this checkout. Local changes add the pi-usage cache location, exact quota network allow-list and redirect blocking, `PI_USAGE_OFFLINE` handling, and the pi-usage CLI/report isolation. Grok, Kimi, and ZCode quota data is never passed to the usage parser, report, incremental state, or upload code. No upstream upload, sync, daemon, or account-management module is included here.

The upstream project declares the MIT license in its package metadata and README. The MIT permission notice is reproduced in the packaged [Vibe Usage notice](../../vendor/vibe-usage/NOTICE.md); it also applies to these adapted quota files. Attribution: Vibe Usage contributors / vibe-cafe.
