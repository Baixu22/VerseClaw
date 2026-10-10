---
lifecycleStatus: archived
id: role-first-memory-ux-v5
title: Role-first memory UX governance v5
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Deepen the Role Memory user workflow with read-only proposal previews, structured editable governance fields, impact visualization, and theme-aligned review surfaces.
touchedAreas:
  - openclaw_runtime/src/memory
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - electron/services/workspace-permissions.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/types/memory.ts
  - shared/i18n/locales
expectedUserBehavior:
  - Users can preview the governance impact of a memory proposal before creating, updating, or superseding memory.
  - The preview is read-only and must not create proposals, cards, audit rows, conflicts, or native memory writes.
  - The Role Memory composer exposes semantic type, scope, sensitivity, confidence, importance, ownership, applicable roles, mutators, phases, expiration, and evidence refs.
  - Injection simulation groups candidates by must, should, may, and never while showing selected/skipped reasons.
  - The detail drawer explains the runtime impact path from proposal to review, apply, injection, retention, archive, or tombstone.
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
  - memory.previewProposal is registered as an operator.read RPC and reuses the real gatekeeper/policy/evidence/conflict logic without mutating SQLite state.
  - Role Memory UI mutations still use hostApi.gateway.rpc only and never direct IPC or direct Gateway HTTP.
  - Structured memory edits submit proposals through existing proposal-first write APIs.
  - Impact simulation displays injection classes, selected/skipped status, scores, reasons, penalties, and whatWouldSelect text.
  - Native OpenClaw memory remains a read-only evidence layer; no MEMORY.md, QMD, dreaming, memorySearch index, or old memory-cards.json mutation is introduced.
docs:
  required: true
  note: Update docs/clawx-design-overview.md with v5 preview, structured editing, and runtime impact UX details.
---
