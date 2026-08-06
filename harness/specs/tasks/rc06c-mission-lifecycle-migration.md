---
id: rc06c-mission-lifecycle-migration
title: RC-06C Mission Lifecycle Migration
taskType: engineering-acceptance
intent: Migrate Mission definitions and run lifecycle toward TaskFlow templates/controllers while keeping mission_runs/events as compatibility reads until migration proof permits retirement. Mission restart, wait, resume, and cancel semantics are preserved; migration and rollback pass.
ownedPaths:
  - openclaw_runtime/src/agents/mission-control/store.ts
  - openclaw_runtime/src/agents/mission-control/controller.ts
  - openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.ts
  - openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.test.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - harness/specs/tasks/rc06c-mission-lifecycle-migration.md
  - artifacts/runtime-authority-convergence/rc-06c/**
touchedAreas:
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/tasks/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-06c/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - Mission definitions first project into TaskFlow templates/controllers, then undergo a controlled single-writer cutover and legacy freeze.
  - mission_runs/events become compatibility reads after cutover and never remain an indefinite lifecycle truth writer.
  - Mission restart, wait, resume, and cancel semantics are preserved.
  - Migration and rollback pass.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - cutting the mission_runs writer before migration proof
  - indefinite dual-write as a migration strategy
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The read-only projection may be default-off only during observation. The controlled cutover configuration selects exactly one lifecycle writer; rollback is an explicit mutually exclusive writer transition.
rollback:
  - Before cutover, disable the projection. After cutover, rollback explicitly restores the legacy writer and freezes the TaskFlow writer; dual-write is forbidden.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/mission-control/mission-taskflow-projection.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts src/tasks/task-flow-cas.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc06c-mission-lifecycle-migration.md
acceptance:
  - Projection, controlled cutover, legacy freeze, and emergency rollback each have explicit evidence; acceptance occurs only after the controlled cutover.
  - Mission restart, wait, resume, and cancel semantics are preserved in the projection.
  - TaskFlow/TaskRegistry is the sole Mission lifecycle writer after cutover. mission_runs/events are compatibility reads or an explicit mutually exclusive rollback path.
  - Product locks remain false; an RC-06C independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-06C Mission Lifecycle Migration

RC-06C migrates Mission definitions and run lifecycle toward TaskFlow templates/controllers while
keeping mission_runs/events as compatibility reads until migration proof permits retirement. This
package implements the read-only TaskFlow projection behind a default-off flag; the legacy
mission_runs writer remains authoritative. Mission restart, wait, resume, and cancel semantics are
preserved, and migration and rollback pass. Indefinite dual-write is not a migration strategy.
