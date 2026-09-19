# Subscription quota commands

Quota collection is an explicit, separate CLI operation. Normal usage report generation never discovers, reads, fetches, caches, or exports quota data.

```bash
pi-usage quota discover --json
pi-usage quota fetch --product kimi-code --json
pi-usage quota fetch --product zcode --product grok --json
```

`discover` only checks ordinary local presence signals such as known directories and executable names. It does not open credential files and does not use the network. `fetch` invokes only the products named with `--product`; provider failures are returned as sanitized product statuses so one provider cannot suppress another.

Every command emits a JSON envelope with `schemaVersion: 1`. Fetchable products return normalized meters with an identifier, label, utilization percentage, and optional reset/window information. Cursor is discoverable but intentionally not fetchable because there is no stable official quota protocol in this integration.

The supported providers are:

- **Kimi Code** reads the official OAuth file at `$KIMI_SHARE_DIR/credentials/kimi-code.json`, or `~/.kimi/credentials/kimi-code.json`. A selected `quota fetch --product kimi-code` may use Kimi's standard refresh grant when the saved access token is near expiry or rejected. If Kimi returns a new login, the command atomically replaces Kimi's own credential file with owner-only mode `0600`; it never writes a separate credential store. This refresh behavior is part of the documented fetch command and does not run during discovery or report generation.
- **ZCode** uses only a caller-supplied `BIGMODEL_API_KEY` or `Z_AI_API_KEY`. The former is sent only to the domestic BigModel quota endpoint; the latter is sent only to the Z.ai quota endpoint. ZCode private OAuth state is not read.
- **Grok** reads at most the final 2 MiB of `$GROK_HOME/logs/unified.jsonl` (default `~/.grok/logs/unified.jsonl`) and accepts only the structured billing status event. It performs no network request and reads no credentials.

Quota network calls are limited to the four exact official Kimi, BigModel, and Z.ai endpoints used by the providers, send `redirect: "error"`, and reject credentials, query strings, and bodies outside the provider protocol. `PI_USAGE_OFFLINE=1` or `quota fetch ... --offline` prevents all quota network calls; local Grok data can still be read. Results from transient credential-backed failures may use the disposable cache.

The cache is isolated from parser and report state. It is stored under `$PI_USAGE_CACHE_DIR/quotas/quota-cache.json`, or `~/.pi/usage/cache/quotas/quota-cache.json` by default. It contains normalized meters and a one-way credential scope hash, never the credential itself. Cache entries expire after seven days and are rejected after their meter window or reset time. Quota results are never added to `usage.json`, CSV files, HTML reports, parser caches, incremental state, or any upload path.

Tests use synthetic files, payloads, mocked fetch implementations, and temporary cache roots. They do not read a real account credential or contact a live provider.
