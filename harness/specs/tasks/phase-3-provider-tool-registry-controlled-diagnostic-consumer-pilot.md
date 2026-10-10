---
lifecycleStatus: archived
id: phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot
title: Phase 3 Provider Tool Registry Controlled Diagnostic Consumer Pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the next Provider/Tool Registry pilot as a controlled diagnostic consumer surface that consumes explicit caller-owned in-memory collector diagnostics while preserving default-off, diagnostics-only, bounded, non-authoritative behavior and forbidding provider ordering, default provider registration, active tool authority, TaskLoop authority, prompt/model-message, Gateway/provider transport, persistence, services, or default cutover.
ownedPaths:
  - harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot/**
  - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/**
  - tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot/**
  - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/**
  - tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/registries.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - electron/services/tool-provider-registry.ts
  - electron/services/mcp-api.ts
expectedUserBehavior:
  - Default context prompts, provider ordering, MCP callTool responses, approval/retry/error semantics, TaskLoop lifecycle/final status/checkpoint behavior, Gateway payloads, provider transport, and renderer/Main boundaries remain unchanged.
  - Controlled diagnostic consumers can only consume explicit caller-owned collector output as bounded shadow diagnostics/metadata/evidence.
  - Registry diagnostics remain in memory or test-owned sinks only and cannot become provider, tool, TaskLoop, prompt, completion, Gateway, or transport authority.
  - This registry pilot does not require AST candidate generation and does not authorize AST behavior.
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
  - provider ordering cutover, default provider registration, automatic provider enablement, active provider authority, active tool authority, TaskLoop authority, prompt authority, completion authority, or default-on registry behavior
  - changing MCP response shape, approval waiting/blocked semantics, retry behavior, tool error mapping, lifecycle payload authority, final status authority, self-check authority, checkpoint authority, reviewer prompts, model messages, Gateway payloads, provider transport, runtime send/receive, delivery, or fallback behavior
  - renderer direct window.electron.ipcRenderer.invoke calls or renderer direct Gateway HTTP/WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - diagnostic persistence outside explicit in-memory/test-owned sinks
  - second runtime service, listener, daemon, HTTP server, WebSocket server, second Gateway, external database, non-MCP transport, or default cutover
featureFlags:
  - runtime.registryDiagnostics.collector remains default false by omission.
  - runtime.registryPilot.enabled remains default false by omission.
  - runtime.providerRegistry.shadow remains default false by omission.
  - runtime.contextProviders.registryPilot remains default false by omission.
  - runtime.toolRegistry.shadow remains default false by omission.
  - Any future diagnostic consumer gate must be explicit, disabled by default, reversible, and unable to enable provider ordering cutover, default provider registration, automatic provider enablement, active tool authority, TaskLoop authority, prompt/model-message changes, Gateway/provider transport changes, persistence, service/listener/daemon behavior, or default-on behavior.
rollback:
  - Omit runtime.registryDiagnostics.collector and existing registry shadow flags.
  - Drop injected collector diagnostics and discard any in-memory consumer output.
  - Keep legacy context, MCP, TaskLoop, Gateway, provider transport, and renderer/Main paths authoritative.
  - No persisted cleanup is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - pnpm --config.verify-deps-before-run=false run comms:replay
  - pnpm --config.verify-deps-before-run=false run comms:compare
  - node scripts/scan-pattern.mjs --pattern "provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|formatTaskLoopContextPackForReviewer|runAgentPrompt|provider transport|TaskLoop authority|tool authority" openclaw_runtime/src/runtime-core/registries.ts openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" openclaw_runtime/src/runtime-core/registries.ts openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
acceptance:
  - Prerequisite status is confirmed as accepted_runtime_use_prerequisites_complete.
  - Controlled readiness status is confirmed as accepted_controlled_runtime_use_readiness.
  - Phase 3 diagnostic collector synthesis remains Status: accepted.
  - The runtime index records the accepted collector surface and does not widen authority.
  - The sample matrix includes registry success, no diagnostics, provider exception, unsupported MCP content, denied/waiting/cancelled-like outcomes, missing/invalid injected diagnostics, gated-off behavior, renderer bypass, provider-ordering-sensitive, persistence, service/listener, and limit/budget sentinels.
  - The quantitative scorecard assigns registry pilot scores across usable value 25, current evidence strength 20, boundary safety 20, verification quantifiability 15, dependency maturity 10, and rollback/reversibility 10.
  - Hard veto gates block any default-on behavior, provider ordering drift, leakage, fail-closed rate below 100 percent, renderer bypass, AST mutation/apply/write surface, TaskLoop/Gateway/provider transport authority drift, rollback failure, or missing required validation without a blocked reason.
  - Harness context and structural validation pass for this pilot spec and predecessor registry specs.
  - Focused registry, context-provider, tool-provider, MCP, TaskLoop, controlled readiness boundary, maintained registry behavior regressions, typecheck, comms replay, comms compare, and boundary scans pass or are recorded with a blocked reason.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 3 Provider Tool Registry Controlled Diagnostic Consumer Pilot

This spec is independent from the AST pilot. It only defines controlled registry diagnostic consumption and does not authorize provider ordering, default provider registration, tool authority, TaskLoop authority, prompt/model-message changes, Gateway/provider transport changes, persistence, services, renderer/Main bypass, AST behavior, or default cutover.
