# @geoqiao/pi-usage

## 0.3.0

### Minor Changes

- efed415: Add a local Code Mode cost-impact calculator comparing observed eligible response tokens and flat-rate cost with direct-tool-call scenarios. Make batching, reusable-prefix caching, additional output/context growth, output retention and Code Mode output-overhead assumptions explicit; show signed deltas, sensitivity scenarios and paired evidence/pricing coverage. Reasoning-inclusive output is not automatically treated as future input. Preserve unknown costs and existing exports. These are fixed-history local counterfactual estimates, not measured whole-session savings or invoices; no model calls, private payload exports or new runtime dependencies.

## 0.2.0

### Minor Changes

- 7f69c1f: Add a local Code Mode execution-efficiency view for native Pi logs: batch coverage, tools per exec mean/median/P75, histograms, response/input evidence and model/session summaries with shared filters. Deduplicate exec/wait snapshots, recover dropped trace counts, and keep pending or unknown evidence outside exact metrics. Export allow-listed execution data in schema v2 JSON and execution.csv while accepting legacy imports. No raw tool payloads, uploads, inferred savings percentage or changes to token pricing.

## 0.1.1

### Patch Changes

- 058a2d4: Refresh the README with a dashboard screenshot, clearer Pi and standalone quick starts, and scannable feature, export, privacy, and pricing guidance. Keep parser details and maintainer workflows available in expandable sections without changing runtime behavior.

## 0.1.0

### Minor Changes

- Add a standalone CLI and Pi /usage-report command for private usage analytics across 28 coding-tool sources. Generate self-contained, interactive BI dashboards: coordinated token-first trend, request composition and dimension rankings; daily histograms and six-value percentile ranges; shared-scale model-price comparisons; and daily aggregated details. Add compact icon-led navigation, responsive charts, keyboard-accessible drilldown, and on-demand provenance instead of long narrative summaries. Add Harness naming, mutually exclusive request-type filters with conservative unknown fallback, and daily Min/Max alongside percentiles. Classify Pi, Claude Code, Codex, ZCode and Kimi requests using response evidence, preserving token totals across fragments, replay and parallel tool calls. Invalidate pre-classification Codex caches once; incomplete associations remain explicitly unclassified. Keep missing records and unknown prices explicit. Export CSV/JSON using an embedded price snapshot with local overrides. Retrieve source data when necessary, but never upload collected usage or include telemetry.
