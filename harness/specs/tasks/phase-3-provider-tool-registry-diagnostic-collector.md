---
lifecycleStatus: archived
id: phase-3-provider-tool-registry-diagnostic-collector
title: Phase 3 Provider Tool Registry Diagnostic Collector
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add the next shadow-only registry slice after the accepted Phase 3 pilot: a runtime-owned diagnostic collector that gathers context/tool provider registry diagnostics and feeds TaskLoop shadow metadata without changing provider ordering, tool results, approvals, prompts, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - electron/services/tool-provider-registry.ts
  - electron/services/mcp-api.ts
  - tests/unit/**
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - electron/services/tool-provider-registry.ts
  - electron/services/mcp-api.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/tool-provider-registry.test.ts
  - tests/unit/mcp-api.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/runtime-provider-tool-registry*.test.ts
  - runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - With registry collector flags disabled, existing context prompts, provider ordering, MCP callTool responses, approvals, task-loop lifecycle, final status, and checkpoint behavior remain unchanged.
  - With collector flags enabled, diagnostics are gathered as bounded shadow metadata/evidence only.
  - Unknown providers, provider exceptions, unsupported MCP content, denied/waiting/cancelled tool outcomes, and non-MCP built-in tool shadows are normalized into diagnostics without breaking legacy defaults.
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
  - provider ordering cutover, default provider registration, automatic provider enablement, or default-on registry behavior
  - changing MCP callTool return shape, approval waiting/blocked semantics, retry behavior, or tool error mapping
  - changing TaskLoop final status, lifecycle payload authority, self-check authority, checkpoint authority, reviewer prompts, model messages, Gateway payloads, or provider transport
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - second runtime service, listener, daemon, HTTP server, WebSocket server, second Gateway, or external database
  - persistence of registry diagnostics outside explicit in-memory/test-owned sinks
featureFlags:
  - runtime.registryPilot.enabled remains default off by omission.
  - runtime.providerRegistry.shadow remains default off by omission.
  - runtime.contextProviders.registryPilot remains default off by omission.
  - runtime.toolRegistry.shadow remains default off by omission.
  - runtime.registryDiagnostics.collector remains default off by omission.
rollback:
  - Disable or omit registry collector and registry shadow flags.
  - Keep legacy context, MCP, TaskLoop, Gateway, and provider paths authoritative.
  - Drop injected collector diagnostics; no persisted cleanup is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry*.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <registry-diagnostic-collector-touched-files>
  - node scripts/scan-pattern.mjs --pattern "provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|formatTaskLoopContextPackForReviewer|runAgentPrompt" <registry-diagnostic-collector-touched-files>
acceptance:
  - Phase 3 synthesis remains the prerequisite and no accepted Phase 3 boundary is widened.
  - A runtime-owned collector can merge context and tool registry diagnostics into bounded shadow output.
  - TaskLoop can receive collector output only through explicit injected diagnostics and shadow metadata/evidence paths.
  - Broader tool-provider shadow coverage includes unsupported MCP content, provider exceptions, denied/waiting/cancelled outcomes, and at least one non-MCP built-in tool shape if an existing safe adapter seam is available.
  - Flag-off behavior and legacy response/status/prompt/checkpoint parity are tested.
  - Comms replay/compare is run if Main/Gateway/Electron service paths are touched.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 3 Provider Tool Registry Diagnostic Collector

This task is the follow-up to the accepted Phase 3 registry pilot. It may collect and merge diagnostics, but it must not make registries authoritative or change default runtime behavior.
