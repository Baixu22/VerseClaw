---
lifecycleStatus: archived
id: runtime-failure-evidence-envelope-failure-summary
title: Runtime Failure Evidence Envelope Failure Summary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Wrap already-sanitized passive `FailureEvent` values in diagnostics-only `EvidenceEnvelope` values with fail-closed validation and no active runtime consumer.
ownedPaths:
  - harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md
  - runtime-research/handoffs/runtime-failure-evidence-envelope-failure-summary/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-evidence-envelope-summary.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-evidence-envelope-failure-summary.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md
  - runtime-research/handoffs/runtime-failure-evidence-envelope-failure-summary/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - Runtime behavior is unchanged when this slice is present.
  - The adapter is inert unless a test or future accepted spec explicitly imports and invokes it.
  - The produced envelope is diagnostics-only, has `kind: 'failure_summary'`, and keeps `authority: 'none'`.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking behavior consumes the envelope.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - docs-sync
  - workspace-harness-single-source
featureFlags:
  - `runtime.evidenceEnvelope.failureSummary` is a contract statement only in this slice; no active runtime path reads it.
  - Omitted or disabled flags leave legacy runtime behavior unchanged because no consumer is wired.
rollback:
  - Delete the failure summary envelope adapter, additive barrel export, focused unit test, task spec, and Phase 2 handoff package.
  - Remove the Phase 2 entries from the parent schema decision log and synthesis.
  - No migration, data cleanup, checkpoint cleanup, lifecycle cleanup, or user-facing rollback is required because no runtime state is written.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-evidence-envelope-failure-summary.test.ts
acceptance:
  - Adapter input must be a `FailureEvent` that passes `validateFailureEvent`.
  - Adapter output is an `EvidenceEnvelope` and passes `validateEvidenceEnvelope`.
  - Envelope `kind` is fixed to `failure_summary`.
  - Envelope `authority` is fixed to `none`; caller attempts to exceed `none` fail closed.
  - Top-level and redaction `rawRetained` are fixed to `false`.
  - Redaction declares no raw retained data and uses a sanitized/secret-scan-passed summary payload.
  - Source, scope, TTL, confidence, and provenance are present and validated.
  - Payload is bounded, JSON-serializable, and contains only sanitized summary, classification metadata, and refs.
  - Payload does not preserve raw prompts, provider payloads, tool args/results, secrets, env dumps, or unredacted workspace content.
  - Invalid `FailureEvent`, missing source/scope/provenance/TTL, expired TTL, oversized payload, `rawRetained: true`, and authority above `none` are rejected.
  - No TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, tool-blocking, service, daemon, listener, server, database, exporter, scheduler, checkpoint, or lifecycle state consumer is introduced.
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking behavior
  - importing the adapter from active runtime paths
  - adding active consumers for `FailureEvent` or `EvidenceEnvelope`
  - adding services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - writing failure events or evidence envelopes into checkpoint or lifecycle authority state
  - treating failure classifier output, evidence, replay output, or scorecard output as proof of task completion
  - allowing envelope authority above `none`
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Evidence Envelope Failure Summary

This Phase 2 slice implements a narrow adapter from Phase 1 passive, sanitized `FailureEvent` values to Phase 0 `EvidenceEnvelope` values.

The adapter is not wired into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking paths. It does not persist evidence, create services, or grant authority to the envelope.

## Pre-Code Answers

1. This slice is diagnostics-only and inert unless explicitly imported.
2. TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking are unchanged when flags are omitted.
3. The only evidence produced is a `failure_summary` `EvidenceEnvelope` wrapping an already-validated passive `FailureEvent`.
4. Only tests or a future accepted spec may consume the envelope.
5. Evidence fails closed on invalid `FailureEvent`, missing source/scope/provenance/TTL, expired TTL, `rawRetained: true`, authority above `none`, non-JSON payload, oversized payload, or envelope validator failure.
6. Replay fixture data does not live in this slice.
7. Rollback is proven by deleting the adapter, additive export, test, spec, and handoff docs with no migration.
8. Promotion stops if the envelope is wired into active runtime behavior, given authority above `none`, persisted to checkpoint/lifecycle state, or allowed to retain raw prompt/provider/tool/secret/env/workspace data.

## Scope

- Add `openclaw_runtime/src/runtime-core/failure-evidence-envelope-summary.ts`.
- Add an additive runtime-core barrel export.
- Add focused unit tests for accept/reject behavior, validator proof, sanitization, no active consumer, and no checkpoint/lifecycle write.
- Add this spec and Phase 2 handoff docs.
- Update the parent governance decision log and synthesis.

## Non-Goals

- No active runtime behavior change.
- No prompt, provider, Gateway, TaskLoop, retry, approval, rollback, completion, or tool-blocking changes.
- No raw evidence persistence or checkpoint/lifecycle authority state writes.
- No services, daemons, listeners, servers, databases, exporters, or schedulers.
