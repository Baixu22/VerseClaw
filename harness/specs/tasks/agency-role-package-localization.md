---
lifecycleStatus: archived
id: agency-role-package-localization
title: Agency Role Package Localization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace live external Agency source dependency with immutable app-owned per-role packages while preserving RoleContract as the only runtime authority.
ownedPaths:
  - docs/superpowers/specs/2026-07-12-agency-role-package-localization-design.md
  - docs/multi-agent-orchestration/phase-constraints/agency-role-package-localization.md
  - harness/specs/rules/agency-role-package-boundary.md
  - harness/specs/tasks/agency-role-package-localization.md
touchedAreas:
  - docs/superpowers/specs/2026-07-12-agency-role-package-localization-design.md
  - docs/multi-agent-orchestration/phase-constraints/agency-role-package-localization.md
  - harness/specs/rules/agency-role-package-boundary.md
  - harness/specs/tasks/agency-role-package-localization.md
  - openclaw_runtime/src/agents/agency-draft-catalog.ts
  - openclaw_runtime/src/agents/agency-role-importer.ts
  - electron/services/agency-role-package-store.ts
  - electron/services/role-promotion-store.ts
  - electron/services/roles-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/AgencyRolePromotionPanel.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/agency-role-package.test.ts
  - tests/unit/roles-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/agency-role-promotion-panel.test.tsx
  - tests/e2e/agency-role-promotion.spec.ts
  - docs/role-first-design.md
  - docs/multi-agent-orchestration/README.md
  - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Users browse an explicitly selected Agency repository without persisting it as runtime authority.
  - Users import one immutable role package at a time.
  - Local packages remain reviewable after the external repository is moved or deleted.
  - Users explicitly check a local package for updates against a newly selected repository.
  - Changed upstream content creates a new package and review.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - agency-role-package-boundary
  - agency-role-promotion-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - host-api-fallback-policy
  - i18n-locale-coverage
  - docs-sync
  - workspace-harness-single-source
forbiddenPatterns:
  - sourceRoot in canonical promotion records
  - external source reads during approval or retry
  - Agency markdown runtime activation
  - automatic tool or permission grants
  - renderer filesystem or raw IPC
  - bulk Agency import
  - Role Memory import
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/agency-role-package-localization.md
  - pnpm harness validate --spec harness/specs/tasks/agency-role-package-localization.md --no-diff
  - pnpm exec vitest run tests/unit/agency-role-package.test.ts tests/unit/agency-role-importer.test.ts tests/unit/agency-role-promotion.test.ts tests/unit/roles-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/agency-role-promotion-panel.test.tsx tests/unit/roles-orchestration-panel.test.tsx tests/unit/role-contract-drift.test.ts
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run typecheck
  - pnpm run lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/agency-role-promotion.spec.ts tests/e2e/role-management.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/agency-role-package-localization.md
  - git diff --check
acceptance:
  - Package identity is deterministic and excludes absolute paths.
  - Package writes are atomic and reads fail closed on integrity errors.
  - Identical imports are idempotent and changed content creates a new version.
  - Approval and retry succeed after the external repository is deleted.
  - Legacy promotion records migrate without losing audit or contract identity.
  - Agency drafts and packages remain permanently non-runnable.
  - Renderer exposes external browsing and a repository-independent local library.
  - Four locales and Electron E2E cover the changed workflow.
docs:
  required: true
  note: Update role-first architecture and all three READMEs for repository-independent local Agency role packages without claiming memory import.
---

# Agency Role Package Localization

This task localizes reviewed Agency source material as immutable app-owned
artifacts. It does not implement Role Memory import.
