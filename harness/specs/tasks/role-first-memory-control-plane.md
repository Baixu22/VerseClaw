---
lifecycleStatus: archived
id: role-first-memory-control-plane
title: Role-first memory control plane
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade the role-first runtime memory layer from MVP JSON cards to a structured SQLite-backed control plane with gatekeeper review, role-aware context-pack injection, and a lightweight Verse Claw management surface.
touchedAreas:
  - openclaw_runtime/src/memory
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales
expectedUserBehavior:
  - Role memory is managed through the runtime memory.* API, not by editing MEMORY.md or memorySearch indexes.
  - memory.propose stores accepted role memory in role-memory.sqlite and sends conflicts/sensitive proposals to review.
  - memory.store remains a legacy wrapper around memory.propose.
  - Role-spawned subagents receive a structured Memory Context pack instead of an unbounded Relevant Memory list.
  - The Roles panel lets users view, add, and archive role memory for the selected role.
  - memory.explainInjection returns explain records for role memory injected into spawned subagents.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - i18n-coverage
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/role-orchestration-methods.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Gateway startup sets the memory store to <state-dir>/role-memory.sqlite.
  - No code imports or writes memory-cards.json for the role-first store.
  - memory.conflicts and memory.explainInjection are operator.read methods.
  - memory.propose/update/archive/supersede/resolveConflict are operator.write methods.
  - Duplicate active memory proposals produce action=needs_review and do not create a second active card.
  - Role-spawn prompt includes "## Memory Context" when matching role memory exists.
docs:
  required: true
  note: Update docs/clawx-design-overview.md role-first memory section.
---

## Control-plane boundaries

- Rules are hard constraints owned by `AGENTS.md` and `harness/specs/**`; Role Memory and automatic extraction must not write `AGENTS.md`, `harness/specs/**`, or `.clawx/rules/*.md`.
- Knowledge stores project facts, architecture rationale, failure lessons, and workflow lessons. Role Memory can cite Knowledge, but automatic role extraction must not apply formal Knowledge.
- Role Memory stores role experience, role preferences, and role-specific failure lessons. Automatic role, trace, and session-summary candidates must remain Memory proposals until explicit review.
- Task Ledger stores current long-task state and evidence. It can supply evidence for memory proposals, but it is not a durable Role Memory or Rules store.

Low-risk manual user proposals may follow the existing user-confirmed save path. Automatic memory proposals are proposal-first and never become applied cards or Project Rules without review.
