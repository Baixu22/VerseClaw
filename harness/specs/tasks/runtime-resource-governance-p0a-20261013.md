---
lifecycleStatus: active
id: runtime-resource-governance-p0a-20261013
title: Runtime Resource Governance P0A - writeSet execution contract and worktree isolation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close issue #213 Work Package A by making the production resource scheduler consume writeSet conflict proof, keeping plan and executed waves aligned, and wiring worktree isolation plus merge/conflict evidence into the real subagent orchestration path.
touchedAreas:
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/role-spawn.test.ts
  - tests/unit/orchestration-worktree-merge.test.ts
  - harness/specs/tasks/runtime-resource-governance-p0a-20261013.md
  - docs/dev/runtime-resource-governance-p0a-20261013.md
expectedUserBehavior:
  - Two writer nodes with proven-disjoint write sets can execute in the same production wave.
  - Two shared-mode writers with intersecting write sets never execute in the same wave.
  - A custom role with a write set cannot bypass conflict checking by omitting built-in write tools.
  - A shared writer without a complete write set is kept in a single-writer wave and the wave explicitly records insufficient-writeSet-proof.
  - A worktree-isolated node receives a real isolated cwd, and completion records merge/conflict evidence through the existing merge queue.
  - The plan executionWaves returned to callers match the waves the production run actually executes.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-resource-governance-p0a-20261013.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0a-20261013.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0a-20261013.md
  - pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/role-spawn.test.ts tests/unit/orchestration-worktree-merge.test.ts`n  - pnpm --dir openclaw_runtime exec vitest run --config vitest.config.ts src/agents/worktree-service.test.ts src/agents/orchestrator-write-set-plan.test.ts src/agents/orchestration-write-set.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Disjoint shared write sets can share a scheduler wave.
  - Intersecting shared write sets are split into separate scheduler waves.
  - Custom role write sets are checked even when the role lacks default write tools.
  - Missing or incomplete writer write sets force a single-writer wave with explicit insufficient-writeSet-proof evidence.
  - The production orchestration path passes an isolated worktree cwd to the child worker and records worktree id/backend/write set metadata.
  - Completed worktree workers are merged through the merge queue, with merged/conflict status and declared-vs-actual write-set drift recorded when git evidence is available.
  - Plan executionWaves and production executionWaves are asserted equal in the same test.
  - No product lock, permission default, external telemetry, or frozen default value changes.
docs:
  required: true
  paths:
    - docs/dev/runtime-resource-governance-p0a-20261013.md
---

# Runtime Resource Governance P0A

This task closes Work Package A from issue #213: the scheduler must treat writeSet declarations as an execution contract instead of only a planning hint, and worktree isolation must have a real production consumer.

## Scope

- Make scheduleResourceAwareWaves consume write-set conflict proof before tool-level exclusivity.
- Keep shared-mode writers with incomplete write sets in single-writer waves and mark the deferral reason.
- Create and pass an isolated worktree cwd for isolation=worktree workers.
- Merge completed isolated workers through the existing merge queue and persist conflict/drift evidence.
- Add focused unit coverage for scheduler semantics, production wave alignment, worktree cwd, merge conflict, and write-set drift.

## Out of scope

- Resource Envelope, unified cross-process admission, shed consumers, and end-to-end stress benchmarks from issue #213 Work Packages B-D.
- New product defaults, locks, external telemetry, or Docker/SSH isolation.
- Replacing the existing merge queue, scheduler authority, or worktree backend defaults.