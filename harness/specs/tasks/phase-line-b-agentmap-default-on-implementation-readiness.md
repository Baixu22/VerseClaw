---
lifecycleStatus: archived
id: phase-line-b-agentmap-default-on-implementation-readiness
title: Line B AgentMap Default-On Implementation Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Validate whether Line B AgentMap can move from default-on proposal readiness into a future implementation spec, without implementing default-on, approving default cutover, or declaring production-ready status.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md
  - runtime-research/handoffs/line-b-agentmap-default-on-implementation-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md
  - runtime-research/handoffs/line-b-agentmap-default-on-implementation-readiness/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - tests/unit/runtime-agent-map-production-entry-readiness.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - package.json
  - pnpm-lock.yaml
expectedUserBehavior:
  - This task is default-on implementation readiness validation and gap filling only; it is not default-on implementation.
  - Default-on remains forbidden.
  - Default cutover remains forbidden.
  - Production-ready status remains forbidden.
  - Default runtime behavior must not change.
  - The default TaskLoop reviewer prompt must not change.
  - Provider ordering must not change.
  - AgentMap must not be registered as a default provider.
  - Candidate, shadow, and replay output must not be persisted.
  - No service, listener, daemon, database, WebSocket server, or HTTP server may be added.
  - Renderer code must not add direct IPC or direct Gateway HTTP/WebSocket calls.
  - AgentMap must not gain runtime, tool, security, approval, retry, completion, provider, model, Gateway, checkpoint, lifecycle, provider-ordering, or runtime-decision authority.
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
  - enabling default-on AgentMap, approving default cutover, declaring production-ready status, adding production opt-in UI, changing default runtime behavior, or changing default TaskLoop reviewer prompt text
  - changing provider ordering, default provider registration, automatic provider enablement, provider/model routing, or transport policy
  - AgentMap candidate text entering default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, chat prompts, user prompts, system prompts, checkpoint payloads, lifecycle payloads, provider ordering, or runtime decisions
  - candidate, shadow, or replay output persistence through localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis, sidecars, queues, fs writes, createWriteStream, cache, reuse, or automatic discovery
  - new service, listener, daemon, database, WebSocket server, HTTP server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct `window.electron.ipcRenderer.invoke(...)`, direct Gateway HTTP/WebSocket calls, or renderer-owned transport switching
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or mutating symbol/workspace operation
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission.
  - runtime.agentMap.promptCandidateControlledCutoverPilot remains default off by omission.
  - runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot remains default off by omission.
  - runtime.agentMap.provider remains separate and default off.
rollback:
  - Disable any AgentMap prompt candidate flag to restore legacy TaskLoop reviewer prompt byte parity.
  - Omit explicit invocation, omit AgentMapResult, pass an invalid or malformed AgentMapResult, use prompt-present exclusions, or exhaust the candidate budget to fail closed with legacy reviewer prompt bytes.
  - No candidate/shadow/replay cleanup is required because this task must not add persistence.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_SENTINEL_DO_NOT_LEAK|AGENTMAP_IMPLEMENTATION_READY_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_DEEP_VALIDATION_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - node scripts/scan-pattern.mjs --pattern "default-on|default cutover|production-ready|ready_for_default_on_implementation_spec|ready_for_default_on_proposal|needs_follow_up|blocked" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-readiness.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|production entry|limited production opt-in|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
  - node scripts/scan-pattern.mjs --pattern "legacy-context-engine|loop-context-pack|AgentMap provider|provider ordering|provider_ordering_drift|createContextProviderRegistryPilot" openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/context-provider-registry.test.ts docs/dev/runtime-research-boundaries.md
acceptance:
  - Handoff includes README, implementation readiness plan, boundary matrix, telemetry requirements, telemetry gap analysis, production rollback runbook, incident veto gates, leakage proof, provider ordering proof, authority boundary review, persistence retention review, default path proof, comms regression plan, UI/docs/i18n boundary, performance/noise scorecard, implementation risk register, implementation spec template, and synthesis.
  - Replay/internal corpus has at least 200 cases covering all requested flags, explicit invocation, AgentMapResult validity, budget, prompt, long-context, multi-file, failed, blocked, provider-ordering-sensitive, checkpoint/lifecycle-sensitive, shadow/cutover/TaskLoop pilots, sentinels, malformed candidate text, leakage scans, persistence scans, provider/model/Gateway transport scans, renderer IPC/Gateway scans, service/listener/database/server scans, mutation scans, README/i18n docs sync scans, and comms replay/compare decision.
  - Focused tests prove default-off legacy parity 100 percent, fail-closed invalid/missing/gated-off cases 100 percent, rollback gate closure 100 percent, leakage_count 0, provider_ordering_drift 0, default reviewer prompt byte drift 0, candidate text absent from default prompts/model messages/Gateway/provider transport/checkpoint/lifecycle payloads, candidate/shadow/replay output non-persistent, authority escalation 0, default-on implementation not enabled, and default cutover not approved.
  - Required tests, typecheck, harness context/validate, scans, rollback drill, leakage proof, provider-ordering proof, performance/noise review, telemetry gap review, comms decision, and veto gates are recorded.
  - `Status: ready_for_default_on_implementation_spec` is allowed only if every required proof passes, corpus is at least 200 cases, score is at least 95, and no hard veto fires; otherwise synthesis must remain `Status: needs_follow_up` or `Status: blocked`.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Default-On Implementation Readiness

This task validates whether the existing default-off AgentMap prompt-candidate track has enough proof to enter a future default-on implementation spec. It does not enable default-on, approve default cutover, declare production-ready status, add a UI, change runtime behavior, change provider ordering, persist candidate output, or grant AgentMap authority.
