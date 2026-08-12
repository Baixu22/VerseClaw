---
id: fix-gateway-session-workspace-resolution
title: Preserve trusted backend workspace context for gateway sessions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure relative-path tools for a Backend-originated agent or chat session resolve from the trusted project workspace selected by Main, instead of the agent default workspace.
touchedAreas:
  - harness/specs/tasks/fix-gateway-session-workspace-resolution.md
  - electron/services/chat-api.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agent.workspace.test.ts
  - openclaw_runtime/src/agents/agent-command.ts
  - openclaw_runtime/src/agents/spawned-context.ts
  - openclaw_runtime/src/agents/spawned-context.test.ts
  - openclaw_runtime/src/auto-reply/templating.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-fast-path.ts
  - openclaw_runtime/src/auto-reply/reply/session.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/gateway/server-methods/agent.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/tools-effective.ts
  - openclaw_runtime/src/gateway/tool-resolution.ts
  - openclaw_runtime/src/gateway/mcp-http.runtime.ts
  - openclaw_runtime/src/gateway/mcp-http.runtime.test.ts
  - openclaw_runtime/src/plugins/session-entry-slot-keys.ts
  - scripts/chain-audit/run-chain-audit.mjs
  - openclaw_runtime/src/gateway/**/*.test.ts
expectedUserBehavior:
  - A task started for a selected workspace resolves relative ls, read, write, and exec paths from that workspace on every turn in the same session.
  - Renderer code sends only a workspace id; Main resolves the trusted absolute root before forwarding it to Gateway.
  - Untrusted gateway clients cannot inject a workspace directory into an agent run.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-gateway-session-workspace-resolution.md
  - pnpm harness validate --spec harness/specs/tasks/fix-gateway-session-workspace-resolution.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway.config.ts src/gateway/server-methods/agent.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Backend agent RPC accepts and persists a non-empty trusted workspace directory for a normal session.
  - A non-Backend client that supplies workspaceDir receives INVALID_REQUEST.
  - Spawned-session workspace remains highest priority, then trusted Backend workspace, then persisted session workspace, then the agent default workspace.
  - tools.effective, tools.invoke, and MCP loopback derive workspace only from persisted session state.
  - Electron Chat resolves the selected workspace root in Main and forwards it through the Backend Gateway path without Renderer supplying an absolute path.
  - Chain audit supplies matrix.common.workspace to each backend agent RPC, so relative project paths resolve under the audited project.
docs:
  required: false
  note: This changes trusted runtime plumbing rather than a user-configurable interface; README variants are reviewed for public-flow changes.
---
