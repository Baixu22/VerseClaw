---
id: agency-role-memory-import
title: Agency Role Memory Import
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Convert reviewed sections from exact active Agency role packages into governed Role Memory proposals without direct memory writes.
expectedUserBehavior:
  - Users extract only recognized governance sections from an exact active local role package.
  - Users select candidates and preview each one through the existing Memory gatekeeper.
  - Submitted candidates appear in human review and never activate directly.
  - Disabling Role Memory disables proposal controls without disabling the local role library.
touchedAreas:
  - docs/superpowers/specs/2026-07-13-agency-role-memory-import-design.md
  - harness/specs/rules/agency-role-memory-import-boundary.md
  - harness/specs/tasks/agency-role-memory-import.md
  - electron/services/agency-role-memory-import.ts
  - electron/services/memory-api.ts
  - electron/services/roles-api.ts
  - electron/main/ipc-handlers.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/AgencyRolePromotionPanel.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/agency-role-memory-import.test.ts
  - tests/unit/memory-api.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/roles-api.test.ts
  - tests/unit/agency-role-promotion-panel.test.tsx
  - tests/unit/helpers/role-gateway-test-utils.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/agency-role-promotion.spec.ts
  - package.json
  - pnpm-lock.yaml
  - docs/role-first-design.md
  - docs/multi-agent-orchestration/README.md
  - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - agency-role-memory-import-boundary
  - agency-role-package-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - host-api-fallback-policy
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/agency-role-memory-import.test.ts tests/unit/roles-api.test.ts tests/unit/agency-role-promotion-panel.test.tsx tests/unit/memory-api.test.ts tests/unit/role-orchestration-methods.test.ts
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run typecheck
  - pnpm exec playwright test tests/e2e/agency-role-promotion.spec.ts tests/e2e/role-memory-panel.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/agency-role-memory-import.md --since HEAD
  - git diff --check
acceptance:
  - Only recognized governance sections produce deterministic proposals.
  - Persona, tools, commands, and code do not produce proposals.
  - Every proposal enters existing review and duplicate/conflict handling.
  - Confidence 0.6 proposals create review records without activating memory cards.
  - Disabled Role Memory blocks generation and submission without affecting packages.
docs:
  required: true
  note: Document AST filtering, active-package eligibility, confidence 0.6 review gating, and the unchanged RoleContract authority boundary.
---

# Agency Role Memory Import

This task adds proposal generation only. It creates no parallel memory store or
permission path.
