---
id: context-family-boundary
title: Context Family Boundary
type: ai-coding-rule
appliesTo:
  - context-family
  - context-family-semantic-constitution
  - context-family-protocol-types
  - context-item-registry-shadow
  - context-family-shadow-ingestion
  - context-lifecycle-event-audit
  - context-lossless-archive-mvp
  - context-status-projection-shadow
  - context-observation-masking-projection
  - context-readonly-recall-surface
  - context-family-policy-promotion
---

Context Family work must unify context semantics without replacing existing
authority layers or changing runtime behavior outside an explicit promotion
spec.

Hard rules:

- Every information unit that Context Family manages is a `ContextItem` with
  stable identity, kind, source reference, lifecycle state, projection metadata,
  and provenance metadata.
- Prompt text is a projection of selected context, not the durable truth source.
- Context Family provides semantic indexes and lifecycle language. It does not
  replace Task Ledger, ClawGraph, Observability, Memory, Knowledge,
  `CompressionArtifact v1`, `LoopContextPack`, Context Pack, transcript JSONL,
  or existing owner stores.
- Registry metadata must not contain large raw payloads. Raw content stays in
  transcript JSONL, approved archive storage, or existing owner stores.
- Do not create a parallel durable source of truth such as `.trellis/`, a second
  task database, an independent rule tree, a hidden context policy store, or a
  separate context fact database.
- Rollout is shadow-first. Shadow work may record diagnostics or metadata only
  and must preserve current user-visible and runtime behavior.
- Flag-off parity is mandatory for any future feature flag. With the flag off,
  prompt text, prompt order, tool execution, approvals, errors, retries, return
  payloads, storage writes, and UI behavior must match legacy behavior.
- No prompt behavior change is allowed without a promotion spec that names the
  prompt boundary, flag-off parity test, rollback path, and targeted validation.
- No active tool-call blocking is allowed in Context Family phases unless a
  future promotion spec explicitly authorizes it with report-only evidence,
  metrics, and rollback. Missing selectors may be diagnostics before promotion.
- Renderer code must not read transcript files, archive files, checkpoint files,
  or runtime state files directly. It must use Host API facades.
- Renderer code must not call Gateway HTTP, WebSocket, JSON-RPC, or other
  runtime endpoints directly. Gateway access stays Main-owned through Host API
  and existing proxy boundaries.
- Lossless archive or lossless recovery claims are forbidden before an
  `ArchiveHandle` exists, verifies content checksum, and participates in
  deletion cleanup.
- Observation masking may only mask `observation` items, must start as
  projection-only, must preserve tool-call structure, and must not run without
  archive handles for the masked payloads.
- Read-only recall must not mutate transcript, Task Ledger, ClawGraph, Memory,
  Knowledge, prompt state, workspace files, approvals, or tool state.
- `CompressionArtifact v1` is a recovery carrier and ledger ContextItem. It is
  not proof of task completion and must not replace Task Ledger, ClawGraph, or
  Observability evidence.

Validation mapping:

- Boundary preservation is testable by path scans and flag-off parity tests that
  no unauthorized Host API, renderer, Gateway, prompt, tool execution, approval,
  compaction, or storage changes occurred.
- Registry payload limits are testable by fixtures that reject large content
  fields in registry records.
- Lifecycle correctness is testable by invalid transition fixtures and by
  provenance event snapshots.
- Archive correctness is testable by checksum mismatch, missing handle, and
  hard-delete cleanup cases.
- Masking correctness is testable by prompt projection snapshots that preserve
  tool-call structure and include recall handles.
- Renderer/Main/Gateway boundaries are testable by scans for direct transcript
  reads and direct Gateway calls from renderer code.
