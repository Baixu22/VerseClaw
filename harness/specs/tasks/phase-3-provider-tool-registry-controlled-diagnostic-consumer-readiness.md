---
id: phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness
title: Phase 3 Provider Tool Registry Controlled Diagnostic Consumer Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Validate whether the accepted Provider/Tool Registry diagnostic collector MVP is ready for the next controlled diagnostic consumer slice while preserving diagnostics-only, caller-owned, default-off behavior and forbidding provider ordering, tool authority, TaskLoop authority, prompt/model-message, Gateway/provider transport, persistence, or default cutover.
ownedPaths:
  - harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md
  - harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
  - runtime-research/handoffs/runtime-use-prerequisites.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md
  - harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
  - runtime-research/handoffs/runtime-use-prerequisites.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/registries.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - electron/services/tool-provider-registry.ts
  - electron/services/mcp-api.ts
  - tests/unit/runtime-provider-tool-registry.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/tool-provider-registry.test.ts
  - tests/unit/mcp-api.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - Default context prompts, provider ordering, MCP callTool responses, approvals, retry/error semantics, TaskLoop lifecycle/final status/checkpoint behavior, Gateway payloads, provider transport, and renderer/Main boundaries remain unchanged.
  - Controlled diagnostic consumers may only use explicit caller-owned collector output as bounded shadow diagnostics/metadata/evidence.
  - Registry diagnostics stay in memory or test-owned sinks only and cannot become provider/tool/TaskLoop authority.
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
  - provider ordering cutover, default provider registration, automatic provider enablement, active provider authority, active tool authority, or default-on registry behavior
  - changing MCP response shape, approval waiting/blocked semantics, retry behavior, tool error mapping, lifecycle payload authority, final status authority, self-check authority, checkpoint authority, reviewer prompts, model messages, Gateway payloads, or provider transport
  - renderer direct window.electron.ipcRenderer.invoke calls or renderer direct Gateway HTTP/WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - diagnostic persistence outside explicit in-memory/test-owned sinks
  - second runtime service, listener, daemon, HTTP server, WebSocket server, second Gateway, external database, or new non-MCP transport
featureFlags:
  - runtime.registryDiagnostics.collector remains default false by omission.
  - runtime.registryPilot.enabled remains default false by omission.
  - runtime.providerRegistry.shadow remains default false by omission.
  - runtime.contextProviders.registryPilot remains default false by omission.
  - runtime.toolRegistry.shadow remains default false by omission.
  - No feature flag may enable provider ordering cutover, default provider registration, automatic provider enablement, active tool authority, TaskLoop authority, prompt/model-message changes, Gateway/provider transport changes, persistence, service/listener/daemon behavior, or default-on behavior.
rollback:
  - Omit runtime.registryDiagnostics.collector and existing registry shadow flags.
  - Drop injected collector diagnostics.
  - Keep legacy context, MCP, TaskLoop, Gateway, provider transport, and renderer/Main paths authoritative.
  - No persisted cleanup is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - pnpm --config.verify-deps-before-run=false run comms:replay
  - pnpm --config.verify-deps-before-run=false run comms:compare
  - rg -n "provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|formatTaskLoopContextPackForReviewer|runAgentPrompt|provider transport|TaskLoop authority|tool authority" openclaw_runtime/src/runtime-core/registries.ts openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md runtime-research/handoffs/runtime-use-prerequisites.md
  - rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" openclaw_runtime/src/runtime-core/registries.ts openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md runtime-research/handoffs/runtime-use-prerequisites.md
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
acceptance:
  - The prerequisite status is confirmed as accepted_runtime_use_prerequisites_complete.
  - The Phase 3 diagnostic collector synthesis remains Status: accepted.
  - The runtime index points to the accepted collector surface and does not claim provider ordering, provider default registration, active tool authority, TaskLoop authority, prompt/model-message insertion, Gateway/provider transport changes, persistence, service/listener/daemon, external database, renderer IPC/Gateway bypass, or default-on behavior.
  - Harness context and structural validation pass for this readiness spec and the predecessor diagnostic-collector spec.
  - Focused registry, context-provider, tool-provider, MCP, and TaskLoop tests pass.
  - Controlled runtime-use boundary sentinels pass and prove registry exports remain diagnostics-only, collector output stays default-off/bounded/caller-owned, TaskLoop shadow diagnostics require every explicit gate, and renderer pages/components do not bypass host-api/Gateway ownership.
  - Typecheck and comms replay/compare pass.
  - Boundary scans have no unclassified forbidden implementation matches.
  - The readiness doc records a final status of accepted_controlled_runtime_use_readiness or needs_revision with command and boundary evidence.
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-use-prerequisites.md
    - runtime-research/agent-runtime-index.md
    - runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/synthesis.md
---

# Phase 3 Provider/Tool Registry Controlled Diagnostic Consumer Readiness

This spec validates the next allowed registry slice after the accepted diagnostic collector MVP. It only permits controlled diagnostic consumer readiness for explicit, bounded, caller-owned, default-off diagnostics. It does not authorize provider ordering, default provider registration, active tool authority, TaskLoop authority, prompt/model-message changes, Gateway/provider transport changes, persistence, services, renderer/Main bypass, or default cutover.
