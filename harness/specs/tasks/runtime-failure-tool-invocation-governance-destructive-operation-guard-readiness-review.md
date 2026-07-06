---
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Readiness Review
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Produce the Phase F readiness decision for the `destructive_operation_guard` line after Phases A-E, deciding whether to continue, stop, or require more evidence without shipping production/default-on behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
expectedUserBehavior:
  - Runtime behavior is unchanged.
  - The Phase D pilot remains default-off and limited to mutation-capable tool invocation preflight.
  - The readiness decision does not turn the guard on by default, approve production rollout, broaden ownership, or change tool behavior.
  - The line may continue only through a separate accepted follow-up spec that preserves default-off flag semantics, preflight ownership, false-block protection, rollback, and boundary constraints.
  - TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, renderer code, and scripts remain non-owners.
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
  - This phase does not add or change feature flags.
  - `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` remains explicit and default-off.
  - Omitted or `false` values preserve legacy behavior.
  - Any future continuation must preserve flag-disable rollback with no migration or state cleanup.
rollback:
  - Delete this readiness-review task spec and handoff package.
  - Remove the Phase F entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required because this phase writes docs/spec material only.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts
acceptance:
  - The new spec has complete harness metadata, intent, owned paths, touched areas, expected user behavior, required rules, feature flag notes, rollback, required tests, acceptance, forbidden patterns, and docs references.
  - The handoff package records the readiness review, validation plan, and synthesis.
  - The decision states one of continue, stop, or require more evidence.
  - The decision explicitly evaluates false-block risk, flag-off legacy proof, preflight owner exclusivity, rollback proof, and consumer boundary proof.
  - The decision preserves all global forbidden lines.
  - The decision does not approve production/default-on behavior, default blocking, ownership broadening, TaskLoop/provider/Gateway/prompt/retry/approval/rollback/completion changes, checkpoint/lifecycle writes, live provider reads, real workspace mutation proof, or services/daemons/listeners/databases/exporters/schedulers.
  - The phase stops after the readiness decision; later work requires a new Goal and separate accepted spec.
forbiddenPatterns:
  - implementing runtime behavior, changing runtime code, changing TaskLoop decisions, changing provider transport, changing Gateway payloads, changing prompt/model-message assembly, changing retry behavior, changing approval behavior, changing rollback behavior, changing completion behavior, changing checkpoint behavior, changing lifecycle behavior, changing renderer behavior, changing Electron service behavior, or changing default tool behavior
  - turning the guard on by default, approving production rollout, default-blocking tools, or broadening active ownership beyond mutation-capable tool invocation preflight
  - treating replay reports, scorecards, governance reports, evidence proof output, holdout success, readiness docs, or this decision as task completion proof
  - using deleted touched-path metadata alone, slow command metadata alone, known dev-server-like long-running metadata, or broad shell command patterns as active triggers
  - reading live providers, executing real tool mutation, modifying the real workspace for proof, scanning unbounded workspace content, or using live provider/tool data as readiness proof
  - writing guard decisions, replay reports, scorecards, governance reports, evidence proof reports, failure events, evidence envelopes, raw prompts, provider payloads, tool args/results, secrets, environment dumps, or workspace content into checkpoint or lifecycle authority state
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Readiness Review

This Phase F package records the readiness decision for the `destructive_operation_guard` line after Phases A-E.

Decision: continue, but only through a separate accepted follow-up spec that preserves default-off behavior, mutation-capable preflight ownership, false-block protection, rollback semantics, and boundary constraints.

This decision does not approve production/default-on behavior and does not implement runtime changes.
