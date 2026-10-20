---
lifecycleStatus: active
id: patch-flow-advisory-orchestrator-wiring
title: Surface patch-flow isolation advice in orchestrator diagnostics
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 21b1ab79a
intent: >-
  Wire recommendIsolationMode into the production orchestrator plan as a
  structured advisory-only diagnostic. The recommendation is derived from real
  task-graph worker/write-set signals and an explicitly supplied duration; it
  never changes plan.isolation, worker isolation, execution waves, or any
  default value.
scenarios:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - coding-runtime-workspace-dcs-producer-boundary
expectedUserBehavior:
  - Every production orchestrator plan carries a structured isolation advisory in routeDiagnostics.
  - A long, dense, overlapping worker plan can recommend patch-flow for diagnostics, while plan.isolation remains the caller-normalized value (default shared).
  - Omitted durationMinutes is treated as zero rather than inventing a duration estimate.
  - Advisory output has an explicit applied:false boundary and is not consumed by isolation normalization or execution.
touchedAreas:
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/agents/orchestrator-write-set-plan.test.ts
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - docs/generated/catalogs/tools.md
  - harness/specs/tasks/patch-flow-advisory-orchestrator-wiring.md
docs:
  required: false
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/patch-flow-advisory-orchestrator-wiring.md
  - pnpm harness validate --spec harness/specs/tasks/patch-flow-advisory-orchestrator-wiring.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/agents/orchestrator-write-set-plan.test.ts src/agents/isolation-mode-matrix.test.ts --reporter=verbose
  - pnpm run catalogs:check
  - pnpm exec eslint openclaw_runtime/src/agents/orchestration-protocol.ts openclaw_runtime/src/agents/orchestrator.ts openclaw_runtime/src/agents/orchestrator-write-set-plan.test.ts shared/dcs/prod-flags-catalog.ts
  - pnpm run typecheck
acceptance:
  - The production orchestrator path calls recommendIsolationMode and records its result in plan.routeDiagnostics.
  - Advisory inputs use real task-graph worker count, write-set density, and pairwise write-set conflict risk; omitted duration is zero.
  - A focused test proves a patch-flow recommendation leaves plan.isolation and worker isolation unchanged with applied:false.
  - A focused test proves no duration and low write density yields a shared advisory while defaults remain unchanged.
  - The catalog patch-flow executor changes from pending-wiring to wired for advisory visibility, while patchFlow.default remains false and execution stays pending TF-0460.
  - Focused runtime tests, catalogs:check, targeted ESLint, harness validation, and typecheck pass; unrelated concurrent-lane failures are recorded as out of scope.
notes:
  - This is TF-0459 only. It intentionally does not execute applyPatchProposalsSerial; TF-0460 handles execution and agent-driven soak.
  - recommendIsolationMode remains advisory-only and must never auto-switch production isolation.
---
