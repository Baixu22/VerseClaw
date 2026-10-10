---
lifecycleStatus: archived
id: rc06a-taskflow-capability-proof
title: RC-06A TaskFlow Capability And Concurrency Proof
taskType: engineering-acceptance
# Pinned to the commit RC-06AR started from; the shared branch diverged from
# origin/main long ago.
diffBase: 6334e23f4fa250fcb7fdd33a86079b31e071de3d
intent: Prove or implement SQLite-level expected-revision CAS, an explicit legal transition graph, restart persistence, concurrent-writer rejection, and delivery-state consistency for TaskFlow. Until this passes, TaskFlow remains a candidate, not a proven universal owner.
ownedPaths:
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - openclaw_runtime/src/tasks/task-flow-cas.test.ts
  - openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts
  - openclaw_runtime/src/tasks/task-flow-registry.store.ts
  - openclaw_runtime/src/tasks/task-flow-registry.ts
  - openclaw_runtime/src/tasks/task-flow-registry.types.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - harness/specs/tasks/rc06a-taskflow-capability-proof.md
  - artifacts/runtime-authority-convergence/rc-06a/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
touchedAreas:
  - openclaw_runtime/src/tasks/**
  - openclaw_runtime/src/state/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-06a/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - TaskFlow SQLite writes use expected-revision CAS so concurrent writers are rejected atomically.
  - An explicit legal transition graph rejects illegal transitions.
  - Flow state survives restart and delivery state stays consistent.
  - Until RC-06A passes, TaskFlow remains a candidate; no legacy domain cutover occurs.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - claiming TaskFlow as the universal workflow owner before RC-06A proof
  - importing a replacement workflow framework automatically on failure
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The TaskFlowCasStore is a controlled proof layer: it is NOT wired into any active path, so the legacy blind upsert remains the only active writer. No feature flag or kill switch is required for the proof; a future cutover would gate the CAS write path behind a flag default-off.
rollback:
  - Disable the CAS flag to restore the legacy blind upsert path.
  - No migration rollback is required because flow_runs is a single-table upsert.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/operator-slice.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc06a-taskflow-capability-proof.md
acceptance:
  - SQLite-level expected-revision CAS rejects a stale write atomically (a second writer with an old revision is rejected).
  - An explicit legal transition graph rejects illegal transitions.
  - Flow state and delivery state survive restart.
  - Concurrent-writer rejection and delivery-state consistency tests pass.
  - TaskFlow remains a candidate; if RC-06A fails, stop for owner review and do not import a replacement framework automatically.
  - Product locks remain false; an RC-06A independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-06A TaskFlow Capability And Concurrency Proof

RC-06A proves or implements the durable concurrency semantics TaskFlow needs before it can be
treated as a workflow owner: SQLite-level expected-revision CAS, an explicit legal transition
graph, restart persistence, concurrent-writer rejection, and delivery-state consistency. Until
this passes, TaskFlow remains a candidate and no legacy domain cutover occurs. On failure the
active package stops for owner review and does not import a replacement framework automatically.
