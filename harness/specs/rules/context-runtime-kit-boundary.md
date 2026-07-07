---
id: context-runtime-kit-boundary
title: Context Runtime Kit Boundary
type: ai-coding-rule
appliesTo:
  - context-runtime-kit
  - context-runtime-kit-phase-0
  - context-runtime-kit-default-on
  - context-runtime-boundary
---

Context Runtime Kit work must preserve context authority boundaries while making future context claims verifiable.

Hard rules:

- Summary text, compact views, and compact or recovery projections are navigation and recovery surfaces only. They can help find or resume context, but they must not be used as the fact source for hard claims.
- A hard claim about a rule, schema, source document, code range, tool result, trace, memory item, or task outcome must cite a resolvable `resource_id`, `selector`, and `checksum`.
- Before a tool call can be considered valid under Context Runtime Kit gates, the runtime must have expanded hard selectors for required fields, enum values, field types, default values, nullable semantics, permission notes, and side-effect notes.
- Compact and `CompressionArtifact` state must preserve dynamic state, blockers, failed attempts, next action, uncertainty, and evidence refs. They must not absorb large durable facts, project rules, tool schemas, code chunks, docs, memory, or task truth as unverified prose.
- Context Runtime Kit rollout is shadow-first. Until a later task spec explicitly promotes behavior, it must not change prompt text, prompt assembly order, tool invocation, approval, retry, error mapping, or return payload behavior. The `context-runtime-kit-default-on` task is such a promotion spec for backend context/prompt/recovery defaults only; it does not authorize UI changes or active tool-call blocking.
- Do not create a parallel durable source of truth such as `.trellis/`, an independent task database, a second rule tree, or a hidden context policy store. Reusable policy belongs in `AGENTS.md` and `harness/specs/**`.
- Context Runtime Kit must not replace Task Ledger, ClawGraph, Observability, Memory, Knowledge, `CompressionArtifact v1`, `LoopContextPack`, or existing Context Pack injection. It may reference those surfaces through evidence refs and bounded projections only.
- Search or registry views may discover candidates. Resolved chunks with matching checksums provide evidence.
- Generated views must mark themselves as navigation-only and carry the selectors that must be expanded before relying on exact facts.
- New active behavior requires a follow-up task spec with flag-off parity, shadow or report-only evidence, explicit rollback, metrics thresholds, and targeted tests.

Validation mapping:

- Summary/view/compact authority is testable by fixtures that reject hard claims without evidence refs.
- Hard-claim citation is testable by schema or contract tests that require `resource_id`, `selector`, and `checksum`.
- Tool-call expansion is testable by tool-schema fixtures that omit each selector family in turn and expect a blocked or report-only missing-selector result.
- Compact boundaries are testable by recovery fixtures that preserve evidence refs and uncertainty while rejecting embedded large source chunks when selectors are available.
- Shadow-first rollout is testable by flag-off parity tests and by scans that no prompt or tool-call path was changed in Phase 0 or Phase 1.
