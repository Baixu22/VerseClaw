---
id: role-first-memory-governance-v3
title: Role-first memory governance v3
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade role-first memory from card/review/injection v2 into a governed role-runtime context system with ownership, semantic types, explicit policy, injection classes, retention suggestions, and detail UI.
touchedAreas:
  - openclaw_runtime/src/memory
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - electron/services/workspace-permissions.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/types/memory.ts
  - shared/i18n/locales
expectedUserBehavior:
  - Role memory cards expose owner/source/applicable role governance fields while old roleTags remain compatible.
  - Semantic memory types classify facts, constraints, preferences, procedures, risks, decisions, episodes, handoffs, and artifact refs.
  - Proposal decisions include risk level, impact scope, suggested action, permission decision, and a concise reason summary.
  - Context pack injection explains must/should/may/never class, score, selected state, penalties, and what would select skipped cards.
  - The Roles panel exposes a memory detail drawer and retention suggestions without writing native MEMORY.md, QMD, dreaming, or memorySearch indexes.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - i18n-coverage
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-memory-v2.test.ts tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/role-orchestration-methods.test.ts
  - pnpm exec playwright test tests/e2e/role-memory-panel.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - memory.policy, memory.detail, memory.retentionCandidates, and memory.restore are registered gateway RPC methods with correct read/write scope.
  - Role-authored high-scope constraints are rejected or sent to review by explicit policy, not scattered ad hoc checks.
  - role-memory-context-v3 explain logs include injectionClass and optional whatWouldSelect.
  - Retention suggestions are read-only until a user turns them into a proposal.
  - Native memory remains a one-way evidence source; role memory does not write native memory stores.
docs:
  required: true
  note: Update docs/clawx-design-overview.md with v3 governance, native evidence bridge, policy engine, injection classes, and detail drawer behavior.
---
