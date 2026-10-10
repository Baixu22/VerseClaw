---
lifecycleStatus: archived
id: agency-role-promotion-control-plane
title: Agency Role Promotion Control Plane
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an explicit, auditable path from immutable Agency source drafts to separate config-backed RoleContracts without allowing governance metadata or source prose to grant runtime authority.
ownedPaths:
  - docs/superpowers/specs/2026-07-12-agency-role-promotion-control-plane-design.md
  - docs/superpowers/plans/2026-07-12-agency-role-promotion-control-plane.md
  - docs/multi-agent-orchestration/phase-constraints/agency-role-promotion-control-plane.md
  - docs/multi-agent-orchestration/goal-mode-start-prompt-agency-role-promotion.md
  - harness/specs/rules/agency-role-promotion-boundary.md
  - harness/specs/tasks/agency-role-promotion-control-plane.md
touchedAreas:
  - openclaw_runtime/src/agents/agency-draft-catalog.ts
  - openclaw_runtime/src/agents/agency-role-importer.ts
  - openclaw_runtime/src/agents/agency-role-promotion.ts
  - electron/services/role-promotion-store.ts
  - electron/services/roles-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/AgencyRolePromotionPanel.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/agency-role-importer.test.ts
  - tests/unit/agency-role-promotion.test.ts
  - tests/unit/roles-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/agency-role-promotion-panel.test.tsx
  - tests/unit/roles-orchestration-panel.test.tsx
  - tests/e2e/agency-role-promotion.spec.ts
  - docs/role-first-design.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/specs/2026-07-12-agency-role-promotion-control-plane-design.md
  - docs/superpowers/plans/2026-07-12-agency-role-promotion-control-plane.md
  - harness/specs/rules/agency-role-promotion-boundary.md
  - harness/specs/tasks/agency-role-promotion-control-plane.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Users select a local Agency Agents repository through the existing directory dialog.
  - Users inspect immutable source identity and candidate validation issues.
  - Users explicitly map or waive every tool hint.
  - Users attach evidence and persist a human review before approval.
  - Approval materializes a separate config RoleContract through agents.roles.
  - Interrupted materialization can be retried and reconciled by exact digest.
  - Active promoted roles can be retired without deleting a same-name replacement.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - agency-role-promotion-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - host-api-fallback-policy
  - i18n-locale-coverage
  - docs-sync
  - workspace-harness-single-source
forbiddenPatterns:
  - Agency markdown runtime activation
  - maturity-driven permission grants
  - automatic tool-hint grants
  - second role registry
  - second role spawn path
  - renderer direct Gateway HTTP
  - renderer direct Gateway WebSocket
  - renderer raw IPC
  - shared memory block implementation
  - role memory self-edit implementation
  - sleeptime agent implementation
  - ToolRule solver implementation
  - new tool executor factory
  - bulk Agency promotion
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/agency-role-promotion-control-plane.md
  - pnpm harness validate --spec harness/specs/tasks/agency-role-promotion-control-plane.md --no-diff
  - pnpm exec vitest run tests/unit/agency-role-importer.test.ts tests/unit/agency-role-promotion.test.ts tests/unit/roles-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/agency-role-promotion-panel.test.tsx tests/unit/roles-orchestration-panel.test.tsx tests/unit/role-contract-drift.test.ts
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run typecheck
  - pnpm run lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/agency-role-promotion.spec.ts tests/e2e/role-management.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/agency-role-promotion-control-plane.md
acceptance:
  - Agency drafts remain permanently non-runnable.
  - Source drafts expose repository-relative paths and stable SHA-256 fingerprints.
  - Lifecycle and evidence qualification remain independent governance axes.
  - Lifecycle and evidence qualification do not derive runtime permissions.
  - Every tool hint is explicitly mapped or waived before review.
  - Review persists without writing an active role.
  - Approval materializes a separate validated config RoleContract.
  - Approval retries are idempotent and interrupted writes are reconcilable by exact digest.
  - Retirement removes only the exact materialized config role and preserves audit history.
  - Renderer uses typed Host API calls and four-locale i18n.
  - Electron E2E covers source selection, review, approval, pending refresh, and retirement.
  - Final evidence includes a reference ledger for ClawX, Agency Agents, and Letta sources actually inspected.
docs:
  required: true
  note: Update role-first architecture, orchestration acceptance matrix, and all three READMEs for the new user-visible workflow without claiming excluded memory, ToolRule, sleeptime, or self-edit capability.
---

# Agency Role Promotion Control Plane

This task is the machine-readable entry point for the controlled Agency draft
review and config role materialization project.

## Binding Control Pack

- `docs/superpowers/specs/2026-07-12-agency-role-promotion-control-plane-design.md`
- `docs/multi-agent-orchestration/phase-constraints/agency-role-promotion-control-plane.md`
- `docs/superpowers/plans/2026-07-12-agency-role-promotion-control-plane.md`
- `docs/multi-agent-orchestration/goal-mode-start-prompt-agency-role-promotion.md`
- `harness/specs/rules/agency-role-promotion-boundary.md`

## Round Discipline

Run R0 through R5 in order. Do not start a round before the previous round has
fresh passing exit evidence. Every round report must include references
inspected, constraints learned, RED -> GREEN proof, acceptance status, and a
forbidden-scope audit.
