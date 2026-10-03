---
id: runtime-failure-evidence-replay-schema-spike
title: Runtime Failure Evidence Replay Schema Spike
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define schema-only contracts and fail-closed validators for `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase` without wiring them into active runtime behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-evidence-replay-schema-spike.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-evidence-replay-contracts.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-evidence-replay-schema-spike.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-evidence-replay-schema-spike.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - With all new flags omitted or disabled, runtime behavior remains unchanged.
  - This slice is schema-only; the validators are inert unless a caller explicitly imports and invokes them in tests or future accepted specs.
  - No failure event, evidence envelope, or replay case is consumed by TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
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
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking behavior
  - adding active runtime consumers for `FailureEvent`, `EvidenceEnvelope`, or `ReplayCase`
  - adding services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - writing evidence into checkpoint or lifecycle authority state
  - evidence authority above `none`
  - replay or scorecard output as task completion proof
featureFlags:
  - `runtime.failureEvidenceReplay.schemaSpike` is schema-only and has no active runtime consumer; omission leaves legacy behavior unchanged.
  - Future `runtime.failureIntelligence.*`, `runtime.evidenceEnvelope.*`, and `runtime.replayHarness.*` consumers remain default-off until separate accepted specs define them.
rollback:
  - Delete the schema-only contracts file, the additive barrel export, the focused unit test, and this follow-up spec.
  - No data migration or user cleanup is required because this slice does not persist evidence or replay artifacts.
  - Future active consumers must define their own flag-disable rollback before promotion.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-evidence-replay-schema-spike.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-replay-schema-spike.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-evidence-replay-schema-spike.test.ts
acceptance:
  - `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase` have exported TypeScript contract types.
  - Validators accept representative valid contracts and reject missing required fields, illegal enum values, malformed timestamps, confidence outside `0..1`, nonpositive TTL, expired evidence, evidence authority other than `none`, `rawRetained: true`, missing redaction, missing provenance, oversized evidence payloads, missing replay provider/tool/workspace fixtures, and replay cases that default to live providers.
  - `EvidenceEnvelope` explicitly requires `authority: 'none'`.
  - `ReplayCase` is fixture-backed by default.
  - The runtime-core barrel export is additive only.
  - No active runtime behavior, provider/Gateway/prompt path, checkpoint/lifecycle authority state, service, daemon, listener, database, exporter, scheduler, or persistence path is introduced.
  - Schema decision log records the accepted Phase 0 contract decisions.
  - Synthesis records Phase 0 schema spike results without claiming active runtime readiness.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Evidence Replay Schema Spike

This Phase 0 slice implements only the typed contract surface and fail-closed validators for `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase`.

## Pre-Code Answers

1. This slice is schema-only.
2. TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking are unchanged when flags are omitted.
3. No evidence is produced by this slice.
4. No runtime consumer is added; only tests and future accepted specs may explicitly import the validators.
5. Validation fails closed on missing metadata, illegal enums, malformed timestamps, expired evidence, authority above `none`, retained raw data, missing redaction/provenance, confidence outside `0..1`, nonpositive TTL, oversized payloads, missing replay fixtures, and live-provider defaults.
6. Replay fixture data is referenced by `ReplayCase.input.providerFixture`, `toolFixture`, and `workspaceFixture`; this slice does not create or execute fixture data.
7. Rollback is proven by deleting the schema-only file, additive export, test, and docs/spec updates with no migration.
8. Promotion stops if any validator path changes active runtime behavior, grants evidence authority, persists raw data, or treats replay/evidence output as completion proof.
