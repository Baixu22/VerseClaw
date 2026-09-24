---
id: rc06d-task-loop-lifecycle-migration
title: RC-06D Task Loop Lifecycle Migration
taskType: engineering-acceptance
# Pinned to the commit RC-06DR starts from; the shared branch diverged from
# origin/main long ago.
diffBase: 11ee016de
intent: Migrate Task Loop lifecycle (waiting, cancel, terminal state) to TaskFlow last. long_task_checkpoints retain checkpoint material only; replay never executes effects. After this package, TaskFlow/TaskRegistry are the only workflow lifecycle writers.
ownedPaths:
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.test.ts
  - openclaw_runtime/src/agents/task-loop-lifecycle-cutover.test.ts
  - openclaw_runtime/src/agents/long-task-control/store.ts
  - openclaw_runtime/src/tasks/workflow-lifecycle-owner.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md
  - artifacts/runtime-authority-convergence/rc-06d/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
touchedAreas:
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.ts
  - openclaw_runtime/src/agents/task-loop-taskflow-projection.test.ts
  - openclaw_runtime/src/agents/task-loop-lifecycle-cutover.test.ts
  - openclaw_runtime/src/gateway/**
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
  - pnpm --dir openclaw_runtime exec vitest run src/agents/task-loop-taskflow-projection.test.ts src/agents/task-loop-lifecycle-cutover.test.ts
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

RC-06D moves the Task Loop lifecycle (waiting, cancel, terminal state) to the TaskFlow owner last,
through the shared workflow lifecycle owner (`openclaw_runtime/src/tasks/workflow-lifecycle-owner.ts`).
`OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER` selects exactly one writer: `legacy` (default), `projection`
(an observational copy; every rejected write is recorded as drift; `RC06D_TASK_LOOP_PROJECTION`
stays an alias), or `taskflow` (the cutover). Under the cutover the controller commits each
lifecycle status change to TaskFlow before it acts on it; a human wait commits `waiting`, a
guardian or evidence block commits `blocked`, and cancel commits `cancelled`. A commit TaskFlow
rejects stops the run at the committed lifecycle (legacy freeze), and the run adopts that status.
Gateway start settles lifecycles of runs the previous boot held as `lost`, and a restarted
process answers their status from TaskFlow without replaying anything. long_task_checkpoints
keep checkpoint material only. Rollback is selecting `legacy`, which freezes the TaskFlow writer.
