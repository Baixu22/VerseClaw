---
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Controlled Runtime Componentization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the default-off `destructive_operation_guard` preflight pilot into a stable controlled runtime preflight component API, without enabling default-on behavior or expanding active ownership beyond mutation-capable tool invocation preflight.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
expectedUserBehavior:
  - Runtime behavior remains legacy allow when the preflight flag is omitted or false.
  - Runtime can call a stable guard component entrypoint from mutation-capable before-tool-call preflight.
  - The component is positioned at the runtime-core tool-governance preflight layer, not TaskLoop, Gateway, provider, prompt, retry, approval, rollback, completion, UI, or persistence layers.
  - The public component entrypoint does not accept a caller-supplied owner; ownership is fixed by the component metadata and before-tool-call integration boundary.
  - Flag-on blocking remains limited to evidence-qualified sanitized candidate metadata.
  - Deleted path metadata alone, partial signals, false-block corpus failing, missing candidate metadata, non-preflight ownership, and non-mutation-capable tools allow.
  - No TaskLoop, Gateway, provider, prompt/model-message, retry, approval, rollback, completion, checkpoint/lifecycle, Electron, renderer, script, service, daemon, listener, database, exporter, or scheduler path becomes an active owner.
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
  - Omitted or `false` means disabled.
  - No new feature flag is added.
rollback:
  - Disable or omit `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` to restore legacy allow behavior.
  - Delete this componentization spec, handoff package, parent doc entries, and the runtime component entrypoint if removal is required.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-feature-config-schema.test.ts
  - pnpm run typecheck
acceptance:
  - A stable runtime component entrypoint exists for mutation-capable preflight use.
  - The low-level evaluator is module-internal and is not exported as a second public runtime entrypoint.
  - The before-tool-call hook calls the component entrypoint instead of assembling the low-level evaluator input inline.
  - Offline scorecard shadow evaluation also uses the component entrypoint rather than a public low-level evaluator.
  - Component metadata states runtime-core tool-governance preflight layer, default-off status, accepted owner, caller-supplied-owner rejection, flag path, and production/default-on non-approval.
  - Flag-off and omitted config preserve legacy allow behavior.
  - Positive control blocks only under explicit flag-on and fully qualified evidence.
  - Deleted path alone, partial signals, false-block corpus failing, non-owner, non-mutation-capable, and missing candidate paths allow.
  - Boundary tests prove no denied roots consume the component.
forbiddenPatterns:
  - defaulting the guard on or claiming default-on/production readiness
  - adding active owners outside mutation-capable tool invocation preflight
  - connecting the component to TaskLoop, Gateway payloads, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle authority state, Electron, renderer, scripts, services, daemons, listeners, databases, exporters, or schedulers
  - retaining raw prompt, provider payload, tool args/results, stdout/stderr, secret, env, unredacted path, or workspace content
  - reading live providers, executing real tool mutation for proof, or mutating the real workspace to manufacture evidence
  - broad shell pattern blocking or deleted path metadata alone as a trigger
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Controlled Runtime Componentization

This phase turns the existing default-off preflight pilot into a stable runtime preflight component API.

It permits controlled runtime use only through mutation-capable tool invocation preflight. It does not approve default-on behavior, production rollout, broad shell blocking, or active ownership expansion.
