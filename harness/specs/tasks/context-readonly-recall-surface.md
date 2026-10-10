---
lifecycleStatus: archived
id: context-readonly-recall-surface
title: Context read-only recall surface
scenario: context-family
taskType: runtime-bridge
intent: Expose read-only recall for archive handles and selector expansion through proper runtime, Main, and Host API boundaries.
touchedAreas:
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/context-engine/**
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/**
  - docs/context-family/**
expectedUserBehavior:
  - Handoff and future agent tools can recover original archived content or selector chunks without renderer file reads.
  - Recall is read-only and does not mutate durable task, memory, knowledge, transcript, or prompt state.
  - The explicit `context_read(include_archived=true)` path may page an archived block in through the existing DCS BlockStore owner API; this conditional lifecycle/presence update is not a recall-side mutation and must not alter payload content or any other owner.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-readonly-recall-surface.md
  - pnpm harness validate --spec harness/specs/tasks/context-readonly-recall-surface.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts --reporter=verbose
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- openclaw_runtime/src/gateway openclaw_runtime/src/context-engine electron/services/sessions-api.ts shared/host-api/contract.ts src/lib/host-api.ts tests/unit docs/context-family
acceptance:
  - Archive handle recall verifies checksum and fails closed on mismatch or missing payload.
  - Selector expansion returns stale/missing/ambiguous diagnostics instead of fabricated success.
  - Renderer uses Host API only and does not read transcript or archive files directly.
  - Recall does not write Memory, Knowledge, Task Ledger, transcript, workspace files, or prompt state.
  - `context_read(include_archived=true)` is mechanically classified as an existing-owner-store lifecycle page-in, not evidence that `ToolRiskLevel=readonly` permits arbitrary durable writes.
  - Handoff can prefer read-only recovery output and still fallback to checkpoint/transcript/ledger/git/trace sources.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Read-only recall is a recovery surface. Mutation must be handled by separate reviewed workflows, except for the explicitly bounded DCS BlockStore owner-store lifecycle page-in above.
