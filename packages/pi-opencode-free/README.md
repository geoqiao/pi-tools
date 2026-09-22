# @geoqiao/pi-opencode-free

Use OpenCode's free models through a native Pi provider. Pi owns the conversation,
system prompt, tools, extension hooks, compaction, branching, and cancellation.

This is an unofficial compatibility package. OpenCode restricts its free tier to
its own client and may change the server checks independently of model listings
or CLI releases. Requests use OpenCode-style client headers. Availability is not
guaranteed; refreshing the catalog cannot repair a changed access policy.

## Install

Requires Node.js 22.19+ and Pi 0.84.2+. Integration verified with Pi 0.86.1.

```sh
pi install npm:@geoqiao/pi-opencode-free
```

Run `/reload` in an existing Pi session, then select a model under
`opencode-free`. RPC clients can use `get_available_models` and `set_model`.
No API key or OpenCode installation is required. The provider always uses
anonymous access, including when an OpenCode account key is configured elsewhere.

If you already have a local `extensions/opencode-free.ts`, move it outside the
extensions directory before loading this package. Keep a backup; loading two
providers with the same ID makes registration order determine which one runs.

## Model updates

- Before registration, read the cache and fetch the catalog if absent or older
  than one hour. First-install RPC and `pi --list-models opencode-free` therefore
  see discovered models without requiring a later session hook.
- Intersect `https://opencode.ai/zen/v1/models` with the `opencode` records from
  `https://models.dev/api.json`. The former supplies IDs, not prices or capabilities.
- Include only zero-priced, non-deprecated models with known text/tool capabilities
  and supported protocol metadata. A `-free` suffix is neither necessary nor sufficient.
- Support OpenAI Chat Completions and Responses. Unsupported protocols and missing
  metadata are excluded and counted in status.
- Use a shared in-flight fetch per provider instance, a 12-second discovery timeout,
  and atomic cache writes. Separate Pi processes may each refresh their own view.
- On fetch or validation failure, retain the previous valid catalog. A valid
  catalog containing no eligible models clears the previous list.
- No background timer, automatic inference probes, account rotation, or paid-model
  fallback. A removed model can fail during an active session; choose a current model.

Commands:

```text
/opencode-free
/opencode-free status
/opencode-free refresh
```

The cache is `~/.pi/agent/cache/opencode-free.json` (under Pi's configured agent
directory). `PI_OPENCODE_FREE_CACHE` can select another file. Pi's `--offline`
mode / `PI_OFFLINE` disables discovery, including manual refresh, and uses the cache.
With no valid offline cache, the provider has no models.

## Tools and compatibility

Normal requests preserve Pi's actual tool declarations. The package does not add,
rename, enable, or execute tools in Pi. Custom tool selections may still be refused
by OpenCode's changing server checks.

Tool-less calls, including Pi's compaction and branch summaries, need an additional
compatibility step: the request declares the schemas of Pi's four default tools.
Those tools remain unavailable for execution.

- Chat Completions requests set `tool_choice: "none"`.
- Current free Responses models reject `none` and accept only `auto`. This package
  uses `auto` and rejects any returned tool call before forwarding it to Pi.
- The same guard also protects Chat Completions if a model ignores `none`.
  An unexpected call becomes a visible error; it is never executed or retried
  with more permissions.

The adapter preserves Pi's native streaming parser and message serialization.
It does not flatten history into a user message or run a second agent loop.
Request hooks run normally; the provider applies its required headers and
tool-less compatibility after caller customization.

## Verification and limits

On 2026-09-22, Pi 0.86.1 completed real tool/hook round trips, manual compaction,
and branch-summary entries with MiMo V2.6 Flash (Chat Completions) and
Muse Spark 1.3 Contributor (Responses). The catalog then contained seven eligible
models; inclusion is not a live health guarantee. Image capability is taken from
metadata; multimodal quality and every listed model have not been live-tested.

Known upstream limits remain visible as normal errors: access-policy rejection,
free quota exhaustion, unavailable models, and incompatible custom tool sets.
There is no known fixed cycle for OpenCode's policy changes.

## Development

To load a local checkout:

```sh
pi install /absolute/path/to/pi-tools/packages/pi-opencode-free
```

```sh
pnpm --filter @geoqiao/pi-opencode-free test
pnpm --filter @geoqiao/pi-opencode-free typecheck
pnpm --filter @geoqiao/pi-opencode-free pack:check
```

Tests use local fixtures, including both native protocol serializers, and make no
external inference calls. See [NOTICE.md](NOTICE.md) for research references.

Optional live acceptance uses the installed `pi` (or `PI_BIN`), a disposable
directory and cache, and several real free-tier generations. Run it explicitly:

```sh
pnpm --filter @geoqiao/pi-opencode-free test:live mimo-v2.6-flash-free
pnpm --filter @geoqiao/pi-opencode-free test:live muse-spark-1.3-contributor-free
pnpm --filter @geoqiao/pi-opencode-free test:live muse-spark-1.3-contributor-free --no-tools
```

It checks RPC discovery/selection, a read and extension-tool/hook round trip,
compaction, and a branch-summary entry. The `--no-tools` variant checks a tool-less
turn instead. It prints the evidence file path and leaves that temporary directory
for inspection. It does not modify global Pi settings or install the extension.
