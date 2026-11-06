---
lifecycleStatus: active
id: skill-mcp-version-alignment
title: Skill configuration convergence and MCP compatibility closeout
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c97ea58faf2e66cc52cabe1df7f9c5b31bc387cd
intent: Close the application Skill configuration gap using the existing runtime config owner, verify legacy migration and managed discovery, and retain the MCP SDK v1 compatibility refresh without claiming v2 or remote Skill activation.
ownedPaths:
  - .gitignore
  - harness/specs/tasks/skill-mcp-version-alignment.md
  - harness/specs/guides/skill-mcp-handling-20261105.md
  - harness/specs/fixtures/skill-mcp-handling-20261105/**
  - openclaw_runtime/package.json
  - openclaw_runtime/pnpm-lock.yaml
  - packages/versebrowser/package.json
  - resources/verseshell-mcp/package.json
  - pnpm-lock.yaml
  - electron/utils/skill-config.ts
  - electron/services/skills-api.ts
  - electron/gateway/config-sync.ts
  - tests/unit/skill-config-runtime-sync.test.ts
  - tests/unit/skills-api-install-trust-gate.test.ts
  - tests/unit/config-sync-source-runtime.test.ts
  - tests/e2e/skills-runtime-config.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/modules/integrations-and-surfaces.md
  - harness/specs/fixtures/skill-mcp-closeout-20261106/**
touchedAreas:
  - openclaw_runtime/package.json
  - openclaw_runtime/pnpm-lock.yaml
  - packages/versebrowser/package.json
  - resources/verseshell-mcp/package.json
  - pnpm-lock.yaml
  - harness/specs/guides/skill-mcp-handling-20261105.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
expectedUserBehavior:
  - Existing Skill loading, MCP transports, authentication, permissions, scopes, and product defaults remain compatible.
  - The three selected direct MCP SDK dependencies use the checked latest v1 release; transitive legacy package identities are reported separately.
  - The report distinguishes application handling from development-agent configuration and distinguishes SDK v1 maintenance from MCP 2026-07-28 support.
forbiddenPatterns:
  - Treating a dependency version bump as implementation of MCP 2026-07-28 or Skills over MCP.
  - Registering external search services or changing local personal skills for this application task.
  - Changing product locks or automatically activating remotely obtained instructions.
requiredTests:
  - node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs harness/specs/fixtures/skill-mcp-closeout-20261106/verify-runtime.mts artifacts/skill-runtime-verification.json
  - pnpm exec vitest run tests/unit/skill-config-runtime-sync.test.ts tests/unit/skills-api-install-trust-gate.test.ts tests/unit/config-sync-source-runtime.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/skills-runtime-config.spec.ts --workers=1
  - pnpm harness context --spec harness/specs/tasks/skill-mcp-version-alignment.md
  - pnpm exec vitest run tests/unit/mcp-api.test.ts tests/unit/runtime-capability-publications.test.ts tests/unit/local-skill-service.test.ts tests/unit/skill-installer-identity.test.ts tests/unit/skills-api-install-trust-gate.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/agent-bundle-mcp-runtime.test.ts src/agents/tool-convergence.test.ts --maxWorkers=1
  - pnpm --dir resources/verseshell-mcp test
  - pnpm --dir packages/versebrowser exec vitest run tests/mcp-result-envelope.test.ts tests/mcp-protocol-cancel.test.ts tests/mcp-surface-sync.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/skill-mcp-version-alignment.md
  - git diff --check
acceptance:
  - Skill configuration is read and atomically updated in runtime-owned openclaw.json; legacy local entries migrate once without overwriting explicit runtime fields.
  - Managed skill sources are registered before Gateway launch; enable/disable/removal survive restart and alter actual runtime discovery.
  - Failed config persistence is returned as failure by installation and toggle paths.
  - Each claimed application capability and gap has a current source reference and an explicit evidence boundary.
  - Registry versions, release dates, installed SDK identity and supported protocol revisions are retained in agent-driven evidence.
  - Package manifests and lockfile resolution agree, with no unrelated dependency update.
  - Relevant existing MCP and Skill tests pass; every timeout or gate failure remains visible.
  - The v2 and remote Skill migration plan reuses existing runtime owners and defines integrity, scope, cache, cancellation and compatibility checks.
docs:
  required: true
  readmeTranslations: required
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - harness/specs/guides/skill-mcp-handling-20261105.md
---

# Skill / MCP handling

This slice repairs Skill runtime configuration and completes the SDK v1 maintenance
refresh. The latest MCP protocol and remote Skills extension remain separate migrations.
Personal skills and development MCP registration are not application configuration.
