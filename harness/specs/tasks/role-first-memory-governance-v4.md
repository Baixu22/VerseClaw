---
id: role-first-memory-governance-v4
title: Role-first memory trustworthy governance v4
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the role-first memory governance loop with retention proposals, batch review, conflict detail, merge drafts, evidence health, injection simulation, and memory health diagnostics.
touchedAreas:
  - openclaw_runtime/src/memory
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - electron/services/workspace-permissions.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/types/memory.ts
  - shared/i18n/locales
expectedUserBehavior:
  - Lifecycle suggestions remain read-only until a user turns them into proposals and reviews them.
  - Review queue supports batch approve/reject/apply-as-cold with per-proposal results.
  - Conflict detail shows related cards/proposals/evidence and merge drafts without applying content changes.
  - Evidence checks inspect role-memory evidence refs without writing native MEMORY.md, QMD, dreaming, or memorySearch indexes.
  - Injection simulation uses the same context-pack selector as runtime injection and displays selected/skipped explanations.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-memory-v2.test.ts tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/role-orchestration-methods.test.ts
  - pnpm exec playwright test tests/e2e/role-memory-panel.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - memory.retentionPropose, memory.reviewBatch, memory.conflictDetail, memory.mergeDraft, memory.evidenceCheck, memory.simulateInjection, and memory.health are registered gateway RPC methods with correct read/write scope.
  - Retention proposals do not mutate cards until review applies them.
  - Batch review continues after individual proposal failures and records batch audit.
  - Merge draft does not create or mutate cards.
  - Injection simulation returns role-memory-context-v3 candidate explanations.
  - Native memory remains a read-only evidence bridge.
docs:
  required: true
  note: Update docs/clawx-design-overview.md with v4 lifecycle closure, conflict workbench, evidence health, injection simulation, and memory health diagnostics.
---
