---
id: rc07-memory-context-slot-convergence
title: RC-07 Memory And Context Slot Convergence
taskType: engineering-acceptance
intent: Enforce one active configured memory slot owner and one DCS contextEngine slot as a startup/config invariant; define each existing mechanism as store owner, candidate producer, review proposal, benchmark arm, or projection. VToken/AgentMap are stateless packer/benchmark arms; Working Context is a query projection; SEKB is human-confirmed governance; Runtime Memory cannot bypass the selected memory slot or DCS. Parallel memory writes are zero; diagnostics-off performs zero query/write; delete/correction propagation tests pass; no default or auto-writeback change.
ownedPaths:
  - openclaw_runtime/src/plugins/slots.ts
  - openclaw_runtime/src/plugins/config-normalization-shared.ts
  - openclaw_runtime/src/agents/slot-convergence.ts
  - openclaw_runtime/src/agents/slot-convergence.test.ts
  - openclaw_runtime/src/memory/memory-store.ts
  - openclaw_runtime/src/memory/memory-policy.ts
  - openclaw_runtime/src/context-engine/registry.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/block-store.ts
  - packages/vtoken/src/vtoken/assembler.py
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/knowledge/sekb/**
  - tests/unit/rc07-memory-context-slot-convergence.test.ts
  - harness/specs/tasks/rc07-memory-context-slot-convergence.md
  - artifacts/runtime-authority-convergence/rc-07/**
touchedAreas:
  - openclaw_runtime/src/plugins/**
  - openclaw_runtime/src/memory/**
  - openclaw_runtime/src/context-engine/**
  - packages/vtoken/**
  - openclaw_runtime/src/knowledge/sekb/**
  - tests/unit/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-07/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - Exactly one configured memory slot owner may persist memory; other systems produce candidates or review proposals only.
  - DCS occupies the single contextEngine slot.
  - VToken/AgentMap are stateless packer/benchmark arms; Working Context is a query projection; SEKB is human-confirmed governance; Runtime Memory cannot bypass the selected memory slot or DCS.
  - Parallel memory writes are zero; diagnostics-off performs zero query/write without weakening single-owner startup/config enforcement; delete/correction propagation tests pass; no default or auto-writeback change.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a new memory database, context store, protocol, or telemetry store
  - automatic SEKB writeback
  - a synchronous mandatory Mem
  - parallel memory writers beyond the single configured slot owner
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - Diagnostics may be default-off. Single-owner memory/context validation is always enforced for an accepted configuration; no flag or kill switch may restore legacy multi-writer authority.
rollback:
  - Rollback selects a prior validated single-owner configuration and clears derived projections/candidates as needed; it cannot restore multi-writer authority.
  - No data migration rollback is required because no new persistent store is introduced.
requiredTests:
  - pnpm exec vitest run tests/unit/rc07-memory-context-slot-convergence.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/slot-convergence.test.ts src/memory/memory-store.test.ts src/context-engine/block-store.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts src/agents/task-loop-taskflow-projection.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc07-memory-context-slot-convergence.md
acceptance:
  - Exactly one active configured memory slot owner persists memory; every other mechanism is classified store owner / candidate producer / review proposal / benchmark arm / projection.
  - DCS occupies the single contextEngine slot; VToken/AgentMap are stateless packer/benchmark arms; Working Context is a query projection; SEKB is human-confirmed governance; Runtime Memory cannot bypass the selected memory slot or DCS.
  - Parallel memory writes are zero; diagnostics-off performs zero query/write while startup/reload reject a second owner; delete/correction propagation tests pass; no default or auto-writeback change.
  - Product locks remain false; an RC-07 independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-07 Memory And Context Slot Convergence

RC-07 enforces one active configured memory slot owner and one DCS contextEngine slot. Every
existing mechanism is classified as a store owner, candidate producer, review proposal, benchmark
arm, or projection. VToken/AgentMap are stateless packer/benchmark arms, Working Context is a query
projection, SEKB is human-confirmed governance, and Runtime Memory cannot bypass the selected
memory slot or DCS. Parallel memory writes are zero, flag-off performs zero query/write, and
delete/correction propagation tests pass with no default or auto-writeback change.
