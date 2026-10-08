---
id: local-runtime-control-plane-active-promotion-boundary
title: Local runtime control plane active promotion boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the guardrails for promoting one Local Runtime Control Plane module from observe-only diagnostics to active behavior without expanding the MVP into a second runtime, hidden task database, or implicit control plane.
ownedPaths:
  - harness/specs/tasks/local-runtime-control-plane-active-promotion-boundary.md
  - harness/specs/tasks/local-runtime-control-plane-mvp.md
  - docs/local-runtime-mvp-roadmap.md
  - openclaw_runtime/src/local-control-plane/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/gateway/**
  - shared/host-api/contract.ts
  - electron/services/**
  - src/lib/**
  - tests/unit/**
  - tests/e2e/**
touchedAreas:
  - harness/specs/tasks/**
  - docs/local-runtime-mvp-roadmap.md
  - openclaw_runtime/src/**
  - shared/**
  - electron/**
  - src/**
  - tests/**
expectedUserBehavior:
  - Active behavior is introduced one module at a time behind an explicit feature flag or user configuration.
  - Legacy behavior remains available and is tested as the default path.
  - Users can inspect active decisions through existing Local Control Plane reports, Gateway/host-api read paths, and Observability traces.
  - No active behavior may silently change prompt text, selected model, capability enablement, evidence verdicts, task status, approval semantics, retry behavior, or event ordering.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - gateway-readiness-policy
  - capability-owner-resolution
  - active-config-guards
  - chat-loop-boundary
  - runtime-local-ecosystem-boundary
  - workspace-harness-single-source
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - promoting more than one active module in a single implementation task
  - active behavior without a default-off feature flag or explicit user configuration
  - changing existing prompt/model/capability/evidence/task behavior while claiming observe-only
  - durable report storage, hidden task database, parallel mission store, or independent correlation index
  - MicroKernel rewrite, second runtime service, second Gateway instance, local HTTP server, or WebSocket side channel
  - renderer direct Gateway HTTP, Gateway WebSocket, or raw IPC calls
  - speculative side effects such as tool execution, skill install, MCP registration, browser clicks, file writes, shell commands, or external network calls
featureFlags:
  - Active context pruning must use a new flag separate from runtime.localControlPlane.contextReport.
  - Active model routing must use a new flag separate from runtime.localControlPlane.modelRouterReport and must preserve an opt-out legacy selected-model path.
  - Active evidence gating must use a new flag separate from runtime.localControlPlane.evidenceReport and must preserve legacy completion/blocked decisions by default.
  - Stronger Skill/MCP isolation must use a new flag or user policy separate from runtime.localControlPlane.capabilityReport and must preserve existing confirmation semantics by default.
rollback:
  - Disable the active feature flag to return to legacy behavior without data migration.
  - Keep observe-only reports available after rollback so the user can compare active and legacy decisions.
  - Do not require deleting user data, replaying durable dual-write state, or running another runtime service.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/local-runtime-control-plane-active-promotion-boundary.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/local-runtime-control-plane-active-promotion-boundary.md --no-diff
implementationTestCandidates:
  - corepack pnpm run typecheck
  - corepack pnpm exec vitest run tests/unit/local-control-plane.test.ts tests/unit/chat-capability-actions.test.ts tests/unit/task-loop-controller.test.ts tests/unit/model-options.test.ts tests/unit/provider-model-sync.test.ts
  - corepack pnpm run comms:replay when Gateway, host-api, api-client, or event paths change
  - corepack pnpm run comms:compare when Gateway, host-api, api-client, or event paths change
acceptance:
  - The task names exactly one active module: context, model_router, capability, evidence, or mission.
  - The task documents the legacy behavior, active behavior, feature flag, rollback behavior, and affected ownership boundaries.
  - The task proves parity with the flag off and explains every observed delta with the flag on.
  - The task keeps Local Control Plane reports diagnostic unless that one active module explicitly consumes its own report under the new flag.
  - The task updates docs and harness specs so future agents do not infer active behavior from the observe-only MVP.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - harness/specs/tasks/local-runtime-control-plane-mvp.md
---

# Local Runtime Control Plane Active Promotion Boundary

This spec is a gate, not an implementation request. It exists so future work can
promote exactly one Local Runtime Control Plane module from observe-only to
active behavior without turning the MVP into an implicit second runtime.

Each active promotion must start by narrowing this spec into a module-specific
task. The narrowed task must name the active decision, the legacy decision it may
replace, the feature flag, the rollback path, and the tests that prove flag-off
parity.

The five legal promotion lanes are:

- Context: active context pruning or ordering.
- Model router: active selected-model override.
- Capability: stronger Skill/MCP isolation or confirmation policy.
- Evidence: active completion, repair, or blocked gate.
- Mission: active lifecycle or next-action policy.

No lane may add durable report storage, a parallel task database, a second
Gateway, a second runtime, or renderer direct backend access.
