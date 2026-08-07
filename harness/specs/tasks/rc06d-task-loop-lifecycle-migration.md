---
id: rc06d-task-loop-lifecycle-migration
title: RC-06D Task Loop Lifecycle Migration
taskType: engineering-acceptance
intent: Migrate Task Loop lifecycle (waiting, cancel, terminal state) to TaskFlow last. long_task_checkpoints retain checkpoint material only; replay never executes effects. After this package, TaskFlow/TaskRegistry are the only workflow lifecycle writers.
ownedPaths:
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/orchestration-quality-scorecard.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.test.ts
  - openclaw_runtime/src/agents/long-task-control/store.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md
  - artifacts/runtime-authority-convergence/rc-06d/**
touchedAreas:
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.test.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - openclaw_runtime/src/tasks/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-06d/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - Task Loop lifecycle first projects read-only into TaskFlow, then migrates through a controlled single-writer cutover and legacy freeze after cancellation/restart proof.
  - long_task_checkpoints retain checkpoint material only; replay never executes effects.
  - After this package, TaskFlow/TaskRegistry are the only workflow lifecycle writers.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - replay that executes effects
  - indefinite dual-write as a migration strategy
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The read-only projection may be default-off only during observation. The controlled cutover configuration selects exactly one lifecycle writer; rollback is an explicit mutually exclusive writer transition.
rollback:
  - Before cutover, disable the projection. After cutover, rollback explicitly restores the legacy writer and freezes the TaskFlow writer; dual-write is forbidden.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/task-loop-taskflow-projection.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/mission-control/mission-taskflow-projection.test.ts src/agents/clawgraph/clawgraph-taskflow-projection.test.ts src/tasks/task-flow-cas.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md
acceptance:
  - Projection, controlled cutover, legacy freeze, and emergency rollback each have explicit evidence; acceptance occurs only after the controlled cutover, with real wait/resume/cancel/terminal/restart tests.
  - long_task_checkpoints retain checkpoint material only; replay never executes effects.
  - After cutover, TaskFlow/TaskRegistry are the only workflow lifecycle writers; the legacy Task Loop controller is removed, frozen, or used only in an explicit mutually exclusive rollback.
  - Product locks remain false; an RC-06D independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-06D Task Loop Lifecycle Migration

RC-06D migrates the Task Loop lifecycle (waiting, cancel, terminal state) to TaskFlow last.
long_task_checkpoints retain checkpoint material only; replay never executes effects. After this
package, TaskFlow/TaskRegistry are the only workflow lifecycle writers. The read-only TaskFlow
projection runs behind a default-off flag; wait/resume/cancel/terminal/restart tests pass before
any writer cutover.
