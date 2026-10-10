---
lifecycleStatus: archived
id: role-first-memory-v2-governance
title: Role-first memory v2 governance loop
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend the role-first memory control plane with proposal-first writes, review queue APIs, scored context-pack injection explanations, deterministic extraction drafts, and a lightweight Roles panel governance surface.
touchedAreas:
  - openclaw_runtime/src/memory
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - electron/services/workspace-permissions.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales
expectedUserBehavior:
  - memory.propose/update/archive/supersede/store create proposal records before applying card changes.
  - Low-risk proposals are applied automatically; conflicts, sensitive content, or scope escalation remain in review.
  - memory.proposals/review/merge/versions/audit/stats expose the governance loop through gateway RPC.
  - Role-spawned subagents receive a scored Context Pack, and injection logs explain selected and skipped candidates.
  - The Roles panel exposes Active, Review, Conflicts, and Injection Logs tabs without direct IPC or Gateway HTTP.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - i18n-coverage
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/role-memory-v2.test.ts
  - pnpm exec playwright test tests/e2e/role-memory-panel.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Proposal records are persisted for accepted, rejected, and needs_review decisions.
  - needs_review proposals do not create active cards until memory.review approves them.
  - context-pack injection explanations include score, selected, bucket or skip reason, and policyVersion role-memory-context-v2.
  - memory.store remains a legacy wrapper over the same proposal-first path.
  - No code writes role-first memory to memorySearch indexes, MEMORY.md, or memory-cards.json.
docs:
  required: true
  note: Update docs/clawx-design-overview.md memory section for v2 governance behavior.
---
