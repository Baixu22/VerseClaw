---
lifecycleStatus: archived
id: fix-agent-gateway-rpc-capability-gap
title: Expose governed session and memory RPCs through the agent gateway tool
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let agents call the existing session fork, checkpoint handoff, and governed memory mutation RPCs without opening a generic Gateway operator surface.
touchedAreas:
  - harness/specs/tasks/fix-agent-gateway-rpc-capability-gap.md
  - openclaw_runtime/src/agents/tools/gateway-tool.ts
  - openclaw_runtime/src/agents/tools/gateway-tool.test.ts
expectedUserBehavior:
  - The gateway tool accepts the documented session fork, checkpoint, and memory actions.
  - RPC parameters are passed in raw as a JSON object using the existing Gateway field names.
  - Methods outside the explicit allowlist remain unavailable to the agent tool.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-agent-gateway-rpc-capability-gap.md
  - pnpm harness validate --spec harness/specs/tasks/fix-agent-gateway-rpc-capability-gap.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/gateway-tool.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - sessions.fork, sessions.resumeCheckpoints, and sessions.checkpointDiff are accepted by the gateway tool schema.
  - memory.propose, memory.store, and memory.update are accepted by the gateway tool schema.
  - Every forwarded method is a core operator.read or operator.write method.
  - Destructive checkpoint restore, admin-scoped, node, plugin, unknown, and other non-allowlisted methods remain unreachable.
  - Forwarding cannot bypass the existing restart, update, config.apply, or config.patch guards.
  - Tests use valid Gateway parameter names and minimum valid memory proposal shape.
docs:
  required: false
  note: The agent-only built-in tool description documents the allowlist and parameter shape. Renderer flows and public README interfaces are unchanged.
---
