---
lifecycleStatus: archived
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Internal Evaluation Scorecard
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an offline internal 0-100 evaluation scorecard for `destructive_operation_guard` using sanitized local transcript metadata plus existing fixture/holdout evidence, without changing active runtime behavior or claiming production/default-on readiness.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
expectedUserBehavior:
  - Runtime behavior is unchanged.
  - The Phase D pilot remains default-off and owned only by mutation-capable tool invocation preflight.
  - The scorecard runs offline and consumes only sanitized metadata, fixture/holdout evidence, and local transcript metadata counts.
  - Local transcripts are reduced to hashed refs, counts, rates, normalized tool names, and candidate signal counts; raw prompts, tool args/results, stdout/stderr, paths, secrets, env, and workspace content are not retained.
  - The result scores internal default-off continuation readiness only and does not claim production/default-on readiness.
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
  - Scorecard output is diagnostics/evaluation metadata only and does not enable active behavior.
rollback:
  - Delete this internal-evaluation-scorecard task spec, runtime-core helper, focused unit test, handoff package, and parent doc entries.
  - Remove the helper export from `openclaw_runtime/src/runtime-core/index.ts`.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts
  - pnpm run typecheck
acceptance:
  - The scorecard produces an `InternalEvaluationReport` with aggregate score, dimensions, hard vetoes, real-data feedback, and optimization plan.
  - The scoring weights are fixed at false-block safety 30, trigger correctness 20, owner/boundary integrity 15, rollback/default-off 15, real-data feedback quality 15, and sanitization/report hygiene 5.
  - Hard vetoes force `blocked_for_continuation` for denied-root consumers or raw/secret/path report leaks.
  - Local transcript scanning supports `~/.openclaw/agents/*/sessions/*.jsonl` and caller-provided roots.
  - Transcript scan output contains hashed refs, counts, rates, normalized tool/candidate metadata, and no raw prompt/tool/env/path/secret/workspace content.
  - Missing local transcripts lowers real-data score but is not a hard veto.
  - Focused tests cover scoring aggregation, hard vetoes, false-block/trigger signals, real-data scanner fixtures, sanitization, and active-consumer boundary.
  - Handoff docs record the current internal score and optimization plan without claiming production/default-on readiness.
forbiddenPatterns:
  - changing active runtime behavior, TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, checkpoint behavior, lifecycle behavior, renderer behavior, Electron service behavior, or default tool behavior
  - adding active consumers outside mutation-capable tool invocation preflight
  - defaulting the pilot on, default-blocking tools, approving production rollout, or claiming production/default-on readiness
  - retaining raw prompts, provider payloads, tool args/results, stdout/stderr, secrets, environment dumps, unredacted paths, or workspace content in reports
  - reading live providers, executing real tool mutation, modifying the real workspace for proof, or using live provider/tool data as proof
  - writing reports into checkpoint or lifecycle authority state
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Internal Evaluation Scorecard

This phase adds an offline internal quantitative scorecard for `destructive_operation_guard`.

It evaluates default-off continuation readiness only. It does not change active runtime behavior and does not approve production/default-on behavior.
