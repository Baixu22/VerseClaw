---
id: runtime-failure-intelligence-passive-shadow
title: Runtime Failure Intelligence Passive Shadow
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a passive, advisory-only failure classifier that emits sanitized bounded `FailureEvent` values through explicit imports only, without changing active runtime behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md
  - runtime-research/handoffs/runtime-failure-intelligence-passive-shadow/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-intelligence-passive-shadow.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md
  - runtime-research/handoffs/runtime-failure-intelligence-passive-shadow/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - Runtime behavior is unchanged when this slice is present.
  - The classifier is inert unless a test or future accepted spec explicitly imports and invokes it.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking behavior consumes the classifier output.
  - `suggestedAction` is advisory text on a `FailureEvent`; it does not trigger retry, ask-user, rollback, stop, completion, or tool blocking.
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
  - `runtime.failureIntelligence.passiveShadow` is a contract statement only in this slice; no active runtime path reads it.
  - Omitted or disabled flags leave legacy runtime behavior unchanged because no consumer is wired.
rollback:
  - Delete the passive classifier file, additive barrel export, focused unit test, task spec, and handoff package.
  - Remove the Phase 1 entries from the parent schema decision log and synthesis.
  - No migration, data cleanup, checkpoint cleanup, lifecycle cleanup, or user-facing rollback is required because no runtime state is written.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-intelligence-passive-shadow.test.ts
acceptance:
  - A typed passive classifier input accepts `id`, `source`, `occurredAt`, `signal`, optional `runId`, optional `evidenceRefs`, and optional bounded message/status metadata.
  - Classifier output is a `FailureEvent` and passes `validateFailureEvent`.
  - The classifier covers `planning`, `tool_call`, `patch`, `test`, `provider`, `gateway`, `user_interrupt`, and `unknown`.
  - The classifier covers `permission`, `path`, `dependency`, `timeout`, `type_error`, `test_failure`, `environment_contamination`, `context_insufficient`, `provider_error`, `gateway_error`, and `unknown`.
  - Summaries are sanitized and bounded, and do not retain raw prompts, provider payloads, tool args/results, secrets, env dumps, or unredacted workspace content.
  - Unknown fallback is stable, bounded, and test-covered.
  - Suggested actions are advisory-only and cannot produce active side effects.
  - No TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, tool-blocking, service, daemon, listener, server, database, exporter, or scheduler path is introduced.
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking behavior
  - importing the classifier from active runtime paths
  - adding active consumers for `FailureEvent`
  - adding services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - writing failure events or evidence into checkpoint or lifecycle authority state
  - treating failure classifier output, evidence, replay output, or scorecard output as proof of task completion
  - allowing `suggestedAction` to trigger real retry, ask-user, rollback, stop, completion, or tool blocking
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Intelligence Passive Shadow

This Phase 1 slice implements passive failure classification only. It creates a typed classifier that emits Phase 0 `FailureEvent` values for diagnostics, tests, and future accepted specs.

The classifier is not wired into TaskLoop, provider transport, Gateway, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking paths. It does not persist evidence, create services, or grant authority to its `suggestedAction`.

## Scope

- Add `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts`.
- Add an additive runtime-core barrel export.
- Add focused unit tests for classification, sanitization, validator proof, unknown fallback, advisory-only suggested actions, and no active consumer.
- Add this spec and Phase 1 handoff docs.
- Update the parent governance decision log and synthesis.

## Non-Goals

- No active runtime behavior change.
- No prompt, provider, Gateway, TaskLoop, retry, approval, rollback, completion, or tool-blocking changes.
- No raw evidence persistence or checkpoint/lifecycle authority state writes.
- No services, daemons, listeners, servers, databases, exporters, or schedulers.

