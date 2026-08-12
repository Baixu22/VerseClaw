---
id: fix-gateway-config-schema-lookup-discovery
title: Make gateway config schema lookup discoverable for agents
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let agents discover valid config schema paths without guessing aliases while preserving the existing Gateway RPC and config mutation boundaries.
touchedAreas:
  - harness/specs/tasks/fix-gateway-config-schema-lookup-discovery.md
  - openclaw_runtime/src/agents/tools/gateway-tool.ts
  - openclaw_runtime/src/agents/tools/gateway-tool.schema-lookup.test.ts
expectedUserBehavior:
  - Calling config.schema.lookup without a path lists the root schema fields.
  - A missing schema path returns an actionable root recovery path instead of only schema_path_not_found.
  - Valid schema paths continue to use the existing config.schema.lookup Gateway RPC.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-gateway-config-schema-lookup-discovery.md
  - pnpm harness validate --spec harness/specs/tasks/fix-gateway-config-schema-lookup-discovery.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/gateway-tool.schema-lookup.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - An omitted or whitespace-only lookup path is normalized to the documented root path '.'.
  - A valid targeted lookup is forwarded unchanged and returns the Gateway result.
  - A missing path response includes recoveryPath='.' and explains that agent settings live under agents.defaults.
  - The change does not add renderer IPC, direct Gateway HTTP, config mutation actions, or transport fallback logic.
docs:
  required: false
  note: This changes only the built-in agent tool response. The public renderer flow and README-documented interfaces are unchanged.
---
