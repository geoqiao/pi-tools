# @geoqiao/pi-usage

## 0.1.1

### Patch Changes

- 058a2d4: Refresh the README with a dashboard screenshot, clearer Pi and standalone quick starts, and scannable feature, export, privacy, and pricing guidance. Keep parser details and maintainer workflows available in expandable sections without changing runtime behavior.

## 0.1.0

### Minor Changes

- Add a standalone CLI and Pi /usage-report command for private usage analytics across 28 coding-tool sources. Generate self-contained, interactive BI dashboards: coordinated token-first trend, request composition and dimension rankings; daily histograms and six-value percentile ranges; shared-scale model-price comparisons; and daily aggregated details. Add compact icon-led navigation, responsive charts, keyboard-accessible drilldown, and on-demand provenance instead of long narrative summaries. Add Harness naming, mutually exclusive request-type filters with conservative unknown fallback, and daily Min/Max alongside percentiles. Classify Pi, Claude Code, Codex, ZCode and Kimi requests using response evidence, preserving token totals across fragments, replay and parallel tool calls. Invalidate pre-classification Codex caches once; incomplete associations remain explicitly unclassified. Keep missing records and unknown prices explicit. Export CSV/JSON using an embedded price snapshot with local overrides. Retrieve source data when necessary, but never upload collected usage or include telemetry.
