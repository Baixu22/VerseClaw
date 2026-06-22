---
id: project-rules-center-mvp
title: Project Rules Center MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a Settings surface for inspecting and bootstrapping project rule entry files without creating a new source of truth.
touchedAreas:
  - shared/host-api/contract.ts
  - electron/services/project-rules-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/pages/Settings/**
  - src/components/settings/**
  - shared/i18n/locales/**/settings.json
  - tests/unit/project-rules-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/project-rules-center.spec.ts
  - harness/specs/tasks/project-rules-center-mvp.md
  - docs/clawx-design-overview.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Users can open Project Rules Center from Settings -> System & Runtime.
  - Users can see whether the active workspace has AGENTS.md and preview its content when present.
  - Users can create a conservative AGENTS.md template only when the file is missing.
  - Users can see .clawx/rules/*.md entries and deterministic validation warnings.
  - Users can read a static explanation of which rule sources are expected to enter agent context or Context Pack recipes.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - workspace-harness-single-source
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - tests/unit/project-rules-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/project-rules-center.spec.ts
acceptance:
  - Renderer calls only hostApi.projectRules for this feature and does not read files directly.
  - Main reads only the active workspace AGENTS.md and .clawx/rules/*.md files for the snapshot.
  - Creating the template never overwrites an existing AGENTS.md.
  - Lint checks are deterministic and do not use AI semantic conflict judgment.
  - AGENTS.md and harness/specs remain documented as the primary project rule sources.
  - All new user-facing strings are covered in en, zh, ja, and ru.
docs:
  required: true
---

Project Rules Center is an inspection and bootstrap UI for existing project rule surfaces. It must not introduce another durable rule store or treat `.clawx/rules/*.md` as more authoritative than AGENTS.md or `harness/specs/**`.
