# Vibe Usage parser attribution

Source: https://github.com/vibe-cafe/vibe-usage
Version: 0.10.21
Commit: `8f8d88fd70612b3853363eb0bd2ff3ba6ae2ef79`
License: MIT (declared in upstream package.json and README; that commit has no standalone LICENSE file).
Attribution: Vibe Usage contributors / vibe-cafe.

Only the transitive parser dependency closure is included (46 source files).
The upload API, sync orchestrator, account configuration, daemon, reset, CLI router and
server-backed summary are deliberately absent. This is an independent package, not an official VibeCafé client.

Local patches:

| File | Change |
|---|---|
| src/parsers/cursor.js | Fixed cursor.com export URL; use the restricted sourceFetch boundary; reject redirects. |
| src/parsers/antigravity.js | Route loopback read RPC through the same restricted boundary. |
| src/parsers/codex-cache.js | Separate PI_USAGE_CACHE_DIR / ~/.pi/usage/cache from the upstream upload client's storage; parser algorithm v4 invalidates pre-classification results and tails. |
| src/parsers/codex.js | Classify complete per-request response intervals; validate optional completion-ledger usage/IDs; retain unknown for ambiguous/cumulative evidence. Preserve requestType through file and tail aggregation without changing usage/replay accounting. |
| src/parsers/zcode.js | Join tool parts by message_id using EXISTS; require finish=stop for non-tool responses; retain unknown with missing part schema or malformed evidence. |
| src/parsers/kimi-code.js | Match current step UUID/turn/usage and legacy completed-step evidence; isolate retry/compaction/subagent output and merge classification across existing message-ID deduplication. |
| src/parsers/aggregate.js | Preserve requestType in bucket grouping; use collision-safe tuple keys. |
| src/parsers/pi-session-jsonl.js | Classify response usage by tool evidence / completion; preserve classification across duplicate records. Invoke the local execution evidence adapter only for native Pi, independently of unchanged token/session accounting. |
| src/parsers/claude-code.js | Classify response usage; merge tool evidence across content fragments without counting usage again. |
| src/parsers/contract.js | Pass optional source-validated execution records to local normalization; preserve the legacy result shape for other parsers. |

`upstream-files.json` preserves original source SHA-256 hashes. Other source files are copied
unchanged. Retained upstream parser tests use PI_USAGE_CACHE_DIR instead of VIBE_USAGE_CACHE_DIR.
Upload/sync tests do not apply and are not included. Tests are not in the published tarball.

## Classification evidence

- Codex: OpenAI Codex commit `89208f09f819c0ff00c2608a33422a5f6b885c76`, `codex-rs/core/src/session/turn.rs` (`ResponseEvent::Completed`, `drain_in_flight`, `send_token_count_event`) and `session/mod.rs` (`record_observed_response_completed`). Completed output items precede per-response usage; tool results are drained before token_count. The newer token_usage_record is used only as corroborating completion evidence, not added again as billed usage. Compaction/cumulative bookkeeping is not assumed to represent one response.
- Legacy Kimi: MoonshotAI/kimi-cli commit `86f136422a0aae6b217ea49e7ea1d2e8a1defcd2`, `src/kimi_cli/soul/kimisoul.py`: StepBegin / StepRetry bound an attempt; StatusUpdate.token_usage is emitted after kosong.step returns the response and before awaiting tool results. SubagentEvent is a separate nested stream.
- Current Kimi: locally verified wire structure: context.append_loop_event step.begin/step.end share UUID, turnId and step; tool.call has stepUuid; step.end.usage matches the following usage.record. No inference from usageScope alone; session-scoped compaction records without this link remain unknown.
- ZCode: local message/part schema; tool part.message_id links to the assistant message. tool_usage execution metrics are not model token usage.

Only synthetic records are retained in regression tests; no private log bodies are vendored.

## Execution evidence (local implementation)

The adapter in `src/pi-execution.js` outside this vendor directory was checked against the native Pi session format and `@howaboua/pi-codex-conversion` 3.0.33 `code-mode/{types,trace-store,tool-result}.ts`. The trace store retains at most 50 nested calls and a cumulative `droppedTraceCount`; terminal snapshots restore counts, not missing per-tool outcomes. Exec/wait association uses tool call and runtime cell IDs, with separate pending/unknown coverage and hashed response/session identifiers. This is not an upstream Vibe Usage feature and does not infer billed requests or net savings. No raw trace, message body or tool input is exported.

## MIT permission notice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
