---
lifecycleStatus: archived
id: phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution
title: Phase 3 Provider Tool Registry Controlled Diagnostic Consumer Pilot Execution
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Execute the accepted Provider/Tool Registry controlled diagnostic consumer pilot with registry-only, caller-owned, in-memory samples that prove operator value, stability, bounded cost, explicit omission accounting, and fail-closed behavior without widening runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution/**
  - tests/unit/runtime-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.test.ts
touchedAreas:
  - harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md
  - runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution/**
  - tests/unit/runtime-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.test.ts
  - openclaw_runtime/src/runtime-core/registries.ts
  - tests/unit/runtime-provider-tool-registry.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/tool-provider-registry.test.ts
  - tests/unit/mcp-api.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
expectedUserBehavior:
  - No user-visible behavior changes.
  - Registry diagnostics remain diagnostic-only, in-memory, caller-owned, bounded, and disabled by default.
  - Legacy context, MCP, TaskLoop, Gateway, provider transport, and renderer/Main behavior remain authoritative.
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
  - AST, astPatchPlanner, AST docs/spec/tests, AST implementation, AST optimization, AST integration, AST invocation, or AST re-evaluation outside this explicit forbidden text.
  - provider ordering cutover, default provider registration, automatic provider enablement, active provider authority, active tool authority, TaskLoop authority, prompt authority, completion authority, or default-on registry behavior.
  - changing MCP response shape, approval waiting/blocked semantics, retry behavior, tool error mapping, lifecycle payload authority, final status authority, self-check authority, checkpoint authority, reviewer prompts, model messages, Gateway payloads, provider transport, runtime send/receive, delivery, or fallback behavior.
  - renderer direct window.electron.ipcRenderer.invoke calls or renderer direct Gateway HTTP/WebSocket calls to 127.0.0.1:18789 or localhost:18789.
  - diagnostic persistence outside explicit in-memory/test-owned fixtures.
  - second runtime service, listener, daemon, HTTP server, WebSocket server, second Gateway, external database, non-MCP transport, or default cutover.
  - treating registry diagnostics as task completion evidence.
featureFlags:
  - runtime.registryDiagnostics.collector remains default false by omission.
  - runtime.registryPilot.enabled remains default false by omission.
  - runtime.providerRegistry.shadow remains default false by omission.
  - runtime.contextProviders.registryPilot remains default false by omission.
  - runtime.toolRegistry.shadow remains default false by omission.
  - Pilot execution may set these flags only inside test-owned/in-memory fixtures and must keep legacy behavior authoritative.
rollback:
  - Disable runtime.registryDiagnostics.collector.
  - Disable runtime.registryPilot.enabled.
  - Disable runtime.providerRegistry.shadow.
  - Disable runtime.contextProviders.registryPilot.
  - Disable runtime.toolRegistry.shadow.
  - Delete or stop injecting registry diagnostics.
  - Preserve legacy context, MCP, TaskLoop, Gateway, provider transport, and renderer/Main behavior as authoritative.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry-controlled-diagnostic-consumer-pilot-execution.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "astPatchPlanner|AST Patch Planner|scanAstPatchPlanner|applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete" <touched files>
  - node scripts/scan-pattern.mjs --pattern "provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|provider transport|TaskLoop authority|tool authority" <touched files>
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <touched files>
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|@temporalio|express\\(" <touched files>
acceptance:
  - A registry-only sample matrix contains at least 30 samples and covers normal/no diagnostics, provider exception, unsupported MCP content, policy denied, policy waiting, tool cancelled, tool error, runtime unavailable, unknown provider, disabled provider, duplicate provider, invalid manifest, invalid injected diagnostics, over-limit diagnostics, gated-off behavior, provider-ordering-sensitive behavior, TaskLoop shadow gate closed, TaskLoop all gates open with legacy authority unchanged, renderer bypass sentinel, persistence sentinel, and service/listener/database sentinel.
  - Each sample records input, expected output, failure mode, boundary assertion, evidence source, actionability classification, and expected metrics contribution.
  - Metrics record diagnostic_count, omitted_diagnostic_count, by_status, by_reason, actionable_rate, noise_rate, collector_latency_ms, fail_closed_rate, provider_ordering_drift, legacy_behavior_drift, renderer_bypass, persistence_matches, and service_listener_database_matches.
  - provider_ordering_drift, legacy_behavior_drift, renderer_bypass, persistence_matches, and service_listener_database_matches are all 0.
  - fail_closed_rate is 100 percent.
  - actionable_rate is greater than noise_rate.
  - collector latency is bounded.
  - Omitted diagnostics are explicitly counted and not silently discarded.
  - Final synthesis status is one of accepted_registry_diagnostic_consumer_pilot_execution_ready, needs_revision, or blocked_by_unrelated_dirty_worktree.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 3 Provider Tool Registry Controlled Diagnostic Consumer Pilot Execution

This task executes the accepted registry diagnostic consumer direction only. It proves registry diagnostic operator value with in-memory samples and metrics, while legacy runtime behavior remains authoritative and no public/user-visible behavior changes are introduced.
