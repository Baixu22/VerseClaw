---
lifecycleStatus: active
id: skill-mcp-version-alignment
title: Skill and MCP handling audit and compatible SDK refresh
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5accfbddbf46839bf7999c70eed31b1b045b640b
intent: Audit the application's Skill and MCP ownership against current standards and refresh the existing MCP SDK v1 compatibility line without claiming the new protocol or remote Skill activation is implemented.
ownedPaths:
  - harness/specs/tasks/skill-mcp-version-alignment.md
  - harness/specs/guides/skill-mcp-handling-20261105.md
  - harness/specs/fixtures/skill-mcp-handling-20261105/**
  - openclaw_runtime/package.json
  - openclaw_runtime/pnpm-lock.yaml
  - packages/versebrowser/package.json
  - resources/verseshell-mcp/package.json
  - pnpm-lock.yaml
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
  - Each claimed application capability and gap has a current source reference and an explicit evidence boundary.
  - Registry versions, release dates, installed SDK identity and supported protocol revisions are retained in agent-driven evidence.
  - Package manifests and lockfile resolution agree, with no unrelated dependency update.
  - Relevant existing MCP and Skill tests pass; every timeout or gate failure remains visible.
  - The v2 and remote Skill migration plan reuses existing runtime owners and defines integrity, scope, cache, cancellation and compatibility checks.
docs:
  required: true
  readmeTranslations: not-required
  files:
    - harness/specs/guides/skill-mcp-handling-20261105.md
---

# Skill / MCP handling

The implementation slice is an SDK v1 maintenance refresh. The latest MCP protocol
and Skills extension require separate runtime migration and acceptance. Neither
personal skills nor development MCP registration is the application owner.
