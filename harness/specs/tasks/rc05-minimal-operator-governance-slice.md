---
id: rc05-minimal-operator-governance-slice
title: RC-05 Minimal Operator Governance Slice
taskType: engineering-acceptance
# Pinned to the commit RC-05R started from; the shared branch diverged from
# origin/main long ago.
diffBase: f4437658e720026ab9edb5efc621cf1b604a0aaf
intent: Build the automated primary path Cron ingress -> existing run identity -> DCS receipts -> desktop Inbox -> durable approval -> one bounded file or message effect -> EffectReceipt -> process restart -> recovery -> delivery projection, plus an automated secondary channel-conformance path that proves the same contract without a real external account. Duplicate effect count is zero, denial produces zero effect, restart preserves pending and completed truth from RC-04, and the UI shows context/effect/recovery lineage.
ownedPaths:
  - openclaw_runtime/src/agents/operator-slice.ts
  - openclaw_runtime/src/agents/operator-slice.test.ts
  - openclaw_runtime/src/agents/approval-ledger.ts
  - openclaw_runtime/src/agents/effect-receipt.ts
  - openclaw_runtime/src/cron/delivery-plan.ts
  - openclaw_runtime/src/cron/delivery.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/extensions/channels/rc05-operator-fixture/**
  - openclaw_runtime/src/gateway/server-methods/inbox.ts
  - openclaw_runtime/src/gateway/server-methods/inbox.test.ts
  - src/stores/inbox.ts
  - scripts/channel-conformance.mjs
  - harness/specs/tasks/rc05-minimal-operator-governance-slice.md
  - artifacts/runtime-authority-convergence/rc-05/**
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
touchedAreas:
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/cron/**
  - openclaw_runtime/src/gateway/**
  - src/stores/**
  - src/pages/Inbox/**
  - scripts/**
  - tests/unit/**
  - harness/specs/**
  - artifacts/runtime-authority-convergence/rc-05/**
expectedUserBehavior:
  - No runtime send behavior, ordering, tools, retries, approvals, delivery, or payload bytes change.
  - A Cron ingress with an existing run identity flows through DCS receipts, desktop Inbox, durable approval, a single bounded file/message effect, EffectReceipt, restart, recovery, and delivery projection.
  - Duplicate effect count is zero; a denial produces zero effect; restart preserves pending and completed truth from RC-04.
  - The channel-conformance fixture proves the same contract without a real external account.
  - The UI shows context/effect/recovery lineage.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - a generic workflow engine or global exactly-once claim
  - a second persistent authority beyond the selected durable owners (approval_ledger, effect_receipts, runtime_receipts)
  - auto-replaying an unknown effect outcome
  - calling a real external channel/provider account in the automated path
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - The Operator slice is behind a feature flag default-off; the kill switch restores the legacy path.
rollback:
  - Disable the Operator slice feature flag to restore the legacy path.
  - No migration rollback is required because all tables are append-only and idempotent.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/operator-slice.test.ts src/gateway/server-methods/inbox.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts
  - pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/rc02-shadow-census.acceptance.test.ts extensions/channels/rc05-operator-fixture/__tests__/conformance.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm run channel:conformance
  - pnpm harness validate --spec harness/specs/tasks/rc05-minimal-operator-governance-slice.md
acceptance:
  - The automated primary path (Cron ingress -> run identity -> DCS receipts -> desktop Inbox -> durable approval -> one bounded file/message effect -> EffectReceipt -> process restart -> recovery -> delivery projection) is exercised end-to-end with zero duplicate effects.
  - The channel-conformance fixture proves the same contract without a real external account.
  - A denial produces zero effect; restart preserves pending and completed truth from RC-04.
  - The UI shows context/effect/recovery lineage.
  - Product locks remain false; an RC-05 independent Verifier accepts using the RC-00 infrastructure.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-05 Minimal Operator Governance Slice

RC-05 wires the automated primary Operator path through existing OpenClaw infrastructure: Cron
ingress -> run identity -> DCS receipts -> desktop Inbox -> RC-04 durable approval -> one bounded
file/message effect -> EffectReceipt -> restart -> recovery -> delivery projection. A
channel-conformance fixture proves the same contract without a real external account. Duplicate
effects are zero, denials produce zero effect, and restart preserves RC-04 pending/completed
truth. The UI shows context/effect/recovery lineage.
