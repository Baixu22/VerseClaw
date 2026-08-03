---
id: rc06b-clawgraph-lifecycle-migration
title: RC-06B ClawGraph Lifecycle Migration
taskType: engineering-acceptance
intent: Migrate ClawGraph run lifecycle from the process Map to the TaskFlow-backed owner using the four-step migration pattern (observe, read-only projection, cut one writer with idempotency and rollback proof, remove or freeze the legacy writer after a compatibility window). Compiler and UI remain; run state moves from process Map only after RC-06A proof. Restart, cancel, child task, and projection tests pass.
ownedPaths:
  - openclaw_runtime/src/agents/clawgraph/runtime.ts
  - openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.ts
  - openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.test.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
  - artifacts/runtime-authority-convergence/rc-06b/**
touchedAreas:
  - openclaw_runtime/src/agents/clawgraph/**
  - openclaw_runtime/src/tasks/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-06b/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - ClawGraph compiler and UI remain unchanged.
  - The run lifecycle is projected read-only into TaskFlow (flow_runs) while the legacy process Map remains authoritative during the observation window.
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
  - The ClawGraph -> TaskFlow read-only projection is behind a feature flag default-off; the kill switch restores the pure legacy path.
rollback:
  - Disable the projection flag to restore the pure legacy ClawGraph path.
  - No migration rollback is required because the projection writes only flow_runs rows that the legacy owner also writes.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
acceptance:
  - ClawGraph run lifecycle is projected read-only into TaskFlow (flow_runs) behind a default-off flag with zero behavior change to the compiler, UI, or legacy process Map.
  - Restart, cancel, child-task, and projection tests pass.
  - The legacy ClawGraph writer remains authoritative until a separate cutover with idempotency and rollback proof is executed.
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

RC-06B migrates ClawGraph run lifecycle from the process Map toward the TaskFlow-backed owner using
the four-step migration pattern. This package implements step 1 (observe the legacy path without
behavior change) and step 2 (a read-only TaskFlow projection) behind a default-off flag; the legacy
process Map remains authoritative. Restart, cancel, child-task, and projection tests prove the
projection before any writer cutover. Indefinite dual-write is not a migration strategy.
