---
id: runtime-failure-replay-harness-core-fixtures
title: Runtime Failure Replay Harness Core Fixtures
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a local/dev/test-only deterministic replay harness core backed by explicit fixtures, producing bounded diagnostics-only reports from validated ReplayCase, FailureEvent, and EvidenceEnvelope data without active runtime consumers.
ownedPaths:
  - harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md
  - runtime-research/handoffs/runtime-failure-replay-harness-core-fixtures/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-replay-harness-core.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/fixtures/runtime-replay/**
  - tests/unit/runtime-failure-replay-harness-core-fixtures.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md
  - runtime-research/handoffs/runtime-failure-replay-harness-core-fixtures/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/fixtures/runtime-replay/**
  - tests/unit/**
expectedUserBehavior:
  - Runtime behavior is unchanged when this slice is present.
  - The replay harness core is inert unless a test or future accepted spec explicitly imports and invokes it.
  - Replay input is fixture-backed only; no live provider, real tool mutation, or real workspace mutation is performed.
  - Replay reports are diagnostics/evaluation metadata only and are not task completion proof.
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
  - `runtime.replayHarness.coreFixtures` is a contract statement only in this slice; no active runtime path reads it.
  - Omitted or disabled flags leave legacy runtime behavior unchanged because no runtime consumer is wired.
rollback:
  - Delete the replay harness core, additive barrel export, fixture files, focused unit test, task spec, and Phase 3 handoff package.
  - Remove the Phase 3 entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, workspace cleanup, or user-facing rollback is required because the harness does not write runtime state.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-replay-harness-core-fixtures.test.ts
acceptance:
  - The first fixture corpus covers `success`, `tool_error`, `test_failure`, `provider_timeout`, and `dirty_workspace`.
  - Every fixture `ReplayCase` passes `validateReplayCase`.
  - Repeated runs of the same fixture produce identical reports.
  - Generated or loaded `FailureEvent` values pass `validateFailureEvent`.
  - Generated or loaded `EvidenceEnvelope` values pass `validateEvidenceEnvelope`, and report decisions preserve `authority: 'none'`.
  - Missing provider/tool/workspace fixtures, empty fixture refs, live provider defaults, invalid scenarios, and invalid/missing budgets fail closed.
  - Reports are JSON-serializable, bounded, diagnostics-only, and contain sanitized replay metadata, fixture refs, failure events, evidence envelope decisions, terminal status, and touched path summaries only.
  - Reports do not preserve raw prompts, provider payloads, tool args/results, secrets, env dumps, or unredacted workspace content.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, tool-blocking, checkpoint, lifecycle, service, daemon, listener, server, database, exporter, or scheduler consumer is introduced.
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking behavior
  - importing the replay harness core from active runtime paths
  - defaulting replay to live providers or network behavior
  - executing real tool mutation or modifying the real workspace
  - adding services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - writing replay reports, failure events, or evidence envelopes into checkpoint or lifecycle authority state
  - treating replay reports, evidence, failure events, or scorecards as task completion proof
  - allowing envelope authority above `none`
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-replay-harness-core-fixtures/README.md
    - runtime-research/handoffs/runtime-failure-replay-harness-core-fixtures/validation-plan.md
    - runtime-research/handoffs/runtime-failure-replay-harness-core-fixtures/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Replay Harness Core Fixtures

This Phase 3 slice implements a deterministic, fixture-backed replay harness core for local/dev/test use only.

The harness accepts a Phase 0 `ReplayCase`, explicit provider/tool/workspace fixture objects, optional Phase 1 failure signals or validated failure events, and optional Phase 2 evidence envelopes. It returns a bounded diagnostics-only report that records sanitized replay metadata, fixture refs, validated failure events, evidence envelope decisions, terminal status, and touched path summaries.

## Pre-Code Answers

1. This slice is diagnostics-only and inert unless explicitly imported by tests or a future accepted spec.
2. TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking are unchanged.
3. Replay inputs are explicit fixtures; live provider defaults fail closed.
4. The harness does not read live providers, execute real tools, mutate the real workspace, or persist runtime state.
5. Failure events are generated through the Phase 1 passive classifier or accepted only after `validateFailureEvent`.
6. Evidence decisions are generated through the Phase 2 failure summary adapter or accepted only after `validateEvidenceEnvelope`.
7. Evidence authority remains `none`.
8. Reports are diagnostics/evaluation metadata only and are not task completion proof.

## Scope

- Add `openclaw_runtime/src/runtime-core/failure-replay-harness-core.ts`.
- Add an additive runtime-core barrel export.
- Add five focused JSON fixtures under `tests/fixtures/runtime-replay`.
- Add focused unit tests for determinism, validation, fail-closed behavior, sanitization, bounded reports, and no active consumer.
- Add this spec and Phase 3 handoff docs.
- Update the parent governance decision log and synthesis.

## Non-Goals

- No active runtime behavior change.
- No prompt, provider, Gateway, TaskLoop, retry, approval, rollback, completion, or tool-blocking changes.
- No raw evidence persistence or checkpoint/lifecycle authority state writes.
- No services, daemons, listeners, servers, databases, exporters, or schedulers.
