---
id: rc04-durable-approval-effect-reconciliation
title: RC-04 Durable Approval And Effect Reconciliation
taskType: engineering-acceptance
intent: Replace the in-memory Gateway process Map approval truth with one durable owner in the existing OpenClaw state boundary; persist the state sequence intent_reserved -> approval_pending -> approved|denied -> execution_started -> applied|not_applied|unknown -> reconciled; define stable approval/effect IDs, idempotency keys, domain-journal joins, and needs_reconciliation; do not create a generic workflow engine or claim global exactly-once.
ownedPaths:
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.ts
  - openclaw_runtime/src/agents/approval-ledger.ts
  - openclaw_runtime/src/agents/effect-receipt.ts
  - openclaw_runtime/src/agents/rc04-durable-approval.test.ts
  - openclaw_runtime/src/agents/rc04-exec-approval-wiring.test.ts
  - openclaw_runtime/src/gateway/exec-approval-manager.ts
  - harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md
  - artifacts/runtime-authority-convergence/rc-04/**
touchedAreas:
  - openclaw_runtime/src/state/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/gateway/**
  - tests/unit/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-04/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - Pending and resolved approval truth survives a Gateway restart.
  - Repeated identical resolve is idempotent; a denial produces no effect.
  - Failure injection at every transition is reconciled from the domain journal.
  - An unknown outcome stops in needs_reconciliation; it is never auto-replayed.
  - EffectReceipt explains but cannot replay the effect.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a generic workflow engine or global exactly-once claim
  - auto-replaying an unknown effect outcome
  - a second persistent approval authority beyond the selected durable owner
  - changing payload bytes, ordering, tools, retries, approvals, or delivery during instrumentation
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The durable approval ledger is written behind a feature flag default-off; the kill switch restores the legacy Gateway process Map path.
rollback:
  - Disable the durable approval flag to restore the legacy process Map path.
  - No migration rollback is required because the approval_ledger table is append-only and idempotent.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts src/agents/receipt-store.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md
acceptance:
  - Pending/resolved approval truth survives a Gateway restart from the durable owner.
  - Repeated identical resolve is idempotent; denial produces zero effect.
  - Failure injection at every transition (intent_reserved -> approval_pending -> approved|denied -> execution_started -> applied|not_applied|unknown -> reconciled) is reconciled from the domain journal.
  - Unknown outcome stops in needs_reconciliation and is never auto-replayed.
  - EffectReceipt explains but cannot replay the effect; domain journals remain the effect/idempotency truth.
  - No generic workflow engine or global exactly-once claim is introduced.
  - Product locks remain false; an RC-04 independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-04 Durable Approval And Effect Reconciliation

RC-04 moves approval pending/resolved truth from the Gateway process Map into one durable owner in
the existing OpenClaw state boundary, persists the full state sequence with stable IDs and
idempotency keys, and introduces an EffectReceipt that correlates and explains domain-journal
outcomes without ever authorizing replay. Unknown outcomes stop in needs_reconciliation. No generic
workflow engine and no global exactly-once claim.
