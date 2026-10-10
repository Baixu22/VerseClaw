---
lifecycleStatus: archived
id: lane-c-tool-protocol-shadow
title: Shadow-normalize MCP tool calls into ToolCallRequest and ToolCallResult
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Establish a feature-flagged shadow normalizer for existing tool-like Main/runtime calls, starting with MCP callTool, without changing legacy MCP API response shapes.
touchedAreas:
  - harness/specs/tasks/lane-c-tool-protocol-shadow.md
  - electron/services/mcp-api.ts
  - electron/services/tool-protocol-shadow.ts
  - shared/types/mcp.ts
  - tests/unit/mcp-api.test.ts
expectedUserBehavior:
  - Existing MCP callTool callers receive the same legacy success, error, and blocked payload shapes.
  - When runtime.toolProtocol.mcpShadow is enabled, Main can emit shadow ToolCallRequest and ToolCallResult records for MCP callTool.
  - Approval-required MCP responses are represented as permission waiting in the shadow result, not as a final denied outcome.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - gateway-readiness-policy
requiredTests:
  - pnpm exec vitest run tests/unit/mcp-api.test.ts
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/lane-c-tool-protocol-shadow.md
acceptance:
  - MCP payloads normalize to ToolCallRequest shadow records.
  - McpCallToolResult values normalize to ToolCallResult shadow records for success, error, blocked, and approval waiting cases.
  - Gateway unavailable fallback normalizes to a blocked ToolCallResult shadow record.
  - Legacy MCP callTool return bytes and enumerable shape remain unchanged.
docs:
  required: false
---
