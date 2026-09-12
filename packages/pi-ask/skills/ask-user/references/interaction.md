# Interaction guide

## Payload and presentation

- Include a stable question `id`, non-empty `prompt`, and a non-empty machine-readable `value` and visible `label` for every option. Question ids must be unique within a call; option values must be unique within a question.
- Keep labels short and options distinct and outcome-oriented. Do not add filler options. Use `description` for meaningful trade-offs.
- Mark grounded preferences with `recommended: true` and explain the reason in `description`; recommendations are presentation-only and never preselected.
- Choose `single` for one expected answer, `multi` for multiple possible selections, and `preview` for richer comparison detail. Every declared preview option must include non-empty `preview` text; descriptions alone do not suffice.
- TUI provides tabbed questions, native single/multi selection, a preview pane, and an internal `Type your own` fallback for every question type, including preview.
- RPC presents questions sequentially with one real option or `Type something…` per question. Use typed input for multiple choices; previews and descriptions flatten into option text. Do not promise same-screen forms, native checkbox cards, a custom preview pane, notes, or a review tab in RPC.

## Follow-ups and interrupted interactions

Explain a blocking gap and its consequence briefly. Use the tool for a needed decision, not a plain-text multiple-choice detour. Bundle questions only when independently answerable; respect the user's interview pacing.

After an elaboration or note, answer it first. Respect `continuation.preservedAnswers`; ask only questions still unresolved. Reopen a settled decision only for materially new information and explain what changed.

Cancellation, skipped questions, and unclear answers are not high-risk approval. Do not repeatedly ask the same unanswered authorization question or silently pick a risky default. Continue independent authorized work. RPC dismissal can skip a required question without cancelling the flow; `cancelled: false` and `required: true` do not prove approval.

For exact result fields and lifecycle behavior, see the [contract](../../../docs/contract.md).
