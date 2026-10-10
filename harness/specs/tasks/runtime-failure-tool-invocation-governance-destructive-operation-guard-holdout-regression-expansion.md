---
lifecycleStatus: archived
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Holdout Regression Expansion
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expand synthetic and fixture-owned holdout/regression coverage for `destructive_operation_guard` false-block protection after the Phase D default-off preflight pilot, without changing runtime scope or approving production/default-on behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
expectedUserBehavior:
  - Default tool behavior remains unchanged because the Phase D pilot is still default-off.
  - Flag-on pilot behavior remains limited to mutation-capable tool invocation preflight and explicit sanitized candidate metadata.
  - Expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata remain non-blocking holdout cases.
  - Expected deletion remains non-blocking even when deleted touched-path metadata and Phase 5 future block metadata are present, as long as edit scorecard failures are absent.
  - Slow test and known dev-server-like long-running metadata remain non-blocking and do not become broad shell pattern blocks.
  - No live providers are read, no real tool mutation is executed, and no real workspace mutation is used as proof.
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
  - comms-regression
  - docs-sync
  - workspace-harness-single-source
featureFlags:
  - `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` remains explicit and default-off.
  - Omitted or `false` values restore legacy allow behavior.
  - Only explicit boolean `true` can exercise the Phase D preflight pilot in holdout tests.
  - This phase does not add a new feature flag.
rollback:
  - Delete this holdout-regression task spec, handoff package, and focused holdout test.
  - Remove the Phase E entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required because this phase adds tests/docs only.
  - The Phase D pilot rollback remains disabling or omitting `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts
acceptance:
  - The new spec has complete harness metadata, intent, owned paths, touched areas, expected user behavior, required rules, feature flag notes, rollback, required tests, acceptance, forbidden patterns, and docs references.
  - The handoff package records Phase E holdout/regression scope, validation plan, and synthesis.
  - A focused holdout test expands non-blocking coverage for expected edit, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata.
  - The holdout test proves flag-off legacy allow behavior and flag-on non-blocking behavior for the holdout cases.
  - The holdout test proves at least one positive control still blocks when all accepted trigger metadata is present.
  - Expected deletion with deleted touched-path metadata and Phase 5 future block metadata remains non-blocking when edit scorecard failures are absent.
  - Slow test and known dev-server-like long-running metadata remain non-blocking and do not act as shell pattern triggers.
  - The Phase D pilot remains default-off and preflight-owned.
  - No runtime implementation, TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron service, renderer, or script behavior is changed.
  - This phase stops after holdout results are recorded and does not begin Phase F readiness review.
forbiddenPatterns:
  - changing runtime implementation, TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, checkpoint behavior, lifecycle behavior, renderer behavior, Electron service behavior, or default tool behavior
  - adding active consumers outside mutation-capable tool invocation preflight
  - defaulting the pilot on or default-blocking tools
  - broadening blocking to shell command patterns
  - using deleted touched-path metadata alone, slow command metadata alone, or known dev-server-like long-running metadata as an active trigger
  - reading live providers, executing real tool mutation, modifying the real workspace for proof, scanning unbounded workspace content, or using live provider/tool data as proof
  - writing guard decisions, replay reports, scorecards, governance reports, evidence proof reports, failure events, evidence envelopes, raw prompts, provider payloads, tool args/results, secrets, environment dumps, or workspace content into checkpoint or lifecycle authority state
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
  - treating holdout success as production/default-on readiness, completion proof, or approval to enter Phase F in the same Goal
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Holdout Regression Expansion

This Phase E package expands synthetic and fixture-owned holdout coverage for the Phase D default-off `destructive_operation_guard` preflight pilot.

It does not modify runtime behavior, add a new active owner, read live providers, execute real tool mutation, mutate the real workspace for proof, or approve production/default-on behavior.

The phase stops after recording holdout results and does not begin Phase F readiness review.
