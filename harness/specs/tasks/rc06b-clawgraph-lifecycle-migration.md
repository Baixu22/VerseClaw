---
lifecycleStatus: archived
id: rc06b-clawgraph-lifecycle-migration
title: RC-06B ClawGraph Lifecycle Migration
taskType: engineering-acceptance
# Pinned to the commit RC-06BR started from; the shared branch diverged from
# origin/main long ago.
diffBase: 0542bdf4eb0a62c8f8a305b3606aee405db6f8da
intent: Migrate ClawGraph run lifecycle from the process Map to the TaskFlow-backed owner using the four-step migration pattern (observe, read-only projection, cut one writer with idempotency and rollback proof, remove or freeze the legacy writer after a compatibility window). Compiler and UI remain; run state moves from process Map only after RC-06A proof. Restart, cancel, child task, and projection tests pass.
ownedPaths:
  - openclaw_runtime/src/agents/clawgraph/runtime.ts
  - openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.ts
  - openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.test.ts
  - openclaw_runtime/src/agents/clawgraph/clawgraph-lifecycle-cutover.test.ts
  - openclaw_runtime/src/tasks/workflow-lifecycle-owner.ts
  - openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
  - artifacts/runtime-authority-convergence/rc-06b/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
touchedAreas:
  - openclaw_runtime/src/agents/clawgraph/**
  - openclaw_runtime/src/tasks/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-06b/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - ClawGraph compiler and UI remain unchanged.
  - The run lifecycle first has a read-only projection while the legacy process Map remains authoritative, then moves through a controlled single-writer cutover and legacy freeze after proof.
  - Restart, cancel, child-task, and projection tests pass.
  - The legacy writer is cut over only after idempotency and rollback proof; indefinite dual-write is not a migration strategy.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - cutting the ClawGraph writer before restart/cancel/child-task/projection proof
  - indefinite dual-write as a migration strategy
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The read-only projection may be default-off only during observation. The controlled cutover configuration selects exactly one lifecycle writer; rollback is an explicit mutually exclusive writer transition.
rollback:
  - Before cutover, disable the projection. After cutover, rollback explicitly restores the legacy writer and freezes the TaskFlow writer; dual-write is forbidden.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts src/agents/clawgraph/clawgraph-lifecycle-cutover.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
acceptance:
  - Projection, controlled cutover, legacy freeze, and emergency rollback each have explicit evidence; acceptance occurs only after the controlled cutover.
  - Restart, cancel, child-task, and projection tests pass.
  - TaskFlow/TaskRegistry is the sole lifecycle writer after cutover. The legacy ClawGraph writer is removed, frozen, or used only in an explicit mutually exclusive rollback.
  - Product locks remain false; an RC-06B independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-06B ClawGraph Lifecycle Migration

RC-06B moves ClawGraph run lifecycle from the process Map to the TaskFlow owner. The writer is
selected by `OPENCLAW_CLAWGRAPH_LIFECYCLE_WRITER`: `legacy` (default; TaskFlow is not written),
`projection` (legacy stays authoritative, TaskFlow receives an observational copy and rejected
writes are recorded as drift), or `taskflow` (the controlled cutover). Under the cutover a run is
created only with its TaskFlow row, and every status change, cancel included, commits through the
TaskFlow CAS writer before the in-memory run applies it; the Map is a cache and a rejected commit
leaves the run unchanged (legacy freeze). Gateway start settles lifecycles whose run the previous
boot held as lost, and a restarted process answers their status from TaskFlow. Emergency rollback
is selecting `legacy` again, which freezes the TaskFlow writer; no mode writes both authorities as
truth. The cutover is exercised by tests and stays opt-in; defaults and product locks do not change.
