---
id: phase-3-provider-tool-registry-pilot
title: Phase 3 provider and tool registry pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Pilot RuntimeContextProviderRegistry and ToolProviderRegistry over accepted Phase-2 shadow adapters without changing legacy behavior by default.
ownedPaths:
  - harness/specs/tasks/phase-3-provider-tool-registry-pilot.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-pilot/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - electron/services/mcp-api.ts
  - electron/services/tool-protocol-shadow.ts
  - tests/unit/**
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - electron/services/mcp-api.ts
  - electron/services/tool-protocol-shadow.ts
  - tests/unit/**
expectedUserBehavior:
  - With Phase-3 registry pilot flags disabled, existing context prompts, MCP callTool responses, approvals, task-loop lifecycle, and checkpoint behavior remain unchanged.
  - With registry pilot flags enabled, ClawX emits provider/tool registry diagnostics and normalized runtime-core evidence as shadow data only.
  - Unknown or failing providers/tools are isolated and recorded as fallback diagnostics instead of breaking legacy defaults.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - any second runtime service, daemon, port, WebSocket server, local HTTP server, or Gateway instance for the registry pilot
  - treating verseshell-runtime as provider/tool registry authority instead of the configured stdio terminal tool exception
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - default-on registry cutover before flag-off and shadow parity tests pass
  - visible MCP tool/catalog additions inside a shadow-only lane
featureFlags:
  - runtime.providerRegistry.shadow defaults off and only emits diagnostics/evidence.
  - runtime.contextProviders.registryPilot defaults off and must preserve prompt/message parity.
  - runtime.toolRegistry.shadow defaults off and must preserve legacy tool response shape.
  - runtime.toolProtocol.mcpShadow remains the proven MCP compatibility shadow flag.
rollback:
  - Disable Phase-3 registry flags and adapter-specific shadow flags.
  - Keep legacy context/tool/task-loop paths authoritative.
  - Remove registry adapter registration without deleting Phase-2 runtime-core contracts.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
  - node scripts/scan-pattern.mjs --pattern 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff
acceptance:
  - Registry contracts/manifests are canonical and do not duplicate runtime-core types.
  - Legacy context/tool/task-loop behavior is unchanged with registry flags disabled.
  - Registry pilot/shadow mode records provider/tool diagnostics, fallback reasons, and evidence refs without changing legacy prompt/tool/status outputs.
  - No second runtime service or renderer transport bypass is introduced.
  - Every accepted lane has path/function/test/command evidence.
docs:
  required: true
---
