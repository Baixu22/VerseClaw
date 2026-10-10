---
lifecycleStatus: archived
id: phase-line-b-agentmap-component-boundary-hardening
title: Line B AgentMap Component Boundary Hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Harden AgentMap as a mature, pause-ready, readonly context-candidate and diagnostic-evidence component without enabling default-on runtime implementation, approving default cutover, or granting runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md
  - runtime-research/handoffs/line-b-agentmap-component-boundary-hardening/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md
  - runtime-research/handoffs/line-b-agentmap-component-boundary-hardening/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - tests/unit/runtime-agent-map-production-entry-readiness.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - AgentMap is hardened as a readonly context-candidate and diagnostic-evidence component only.
  - AgentMap may generate bounded readonly prompt/context candidates.
  - AgentMap may emit counters, booleans, hashes, lengths, and bounded diagnostic codes.
  - AgentMap may enter only the named pilot surface when explicitly invoked with an explicit valid AgentMapResult and all explicit gates enabled.
  - Default-on remains forbidden.
  - Default cutover remains forbidden.
  - Production-ready status remains forbidden.
  - The recommended next state is a development pause for AgentMap capability expansion.
  - The recommended next state is not runtime implementation execution.
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
  - enabling default-on AgentMap, approving default cutover, declaring production-ready status, production rollout, production opt-in UI, or changing default runtime behavior
  - changing the default TaskLoop reviewer prompt text or using AgentMap to decide completion, retry, approval, blocking, repair, or cutover
  - changing provider ordering, default provider registration, automatic provider enablement, provider/model routing, Gateway transport, or transport policy
  - AgentMap candidate text entering default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, chat prompts, user prompts, system prompts, checkpoint payloads, lifecycle payloads, provider ordering, or runtime decisions
  - candidate, shadow, or replay output persistence through localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis, sidecars, queues, fs writes, createWriteStream, cache, reuse, automatic discovery, or build output
  - new service, listener, daemon, database, WebSocket server, HTTP server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct `window.electron.ipcRenderer.invoke(...)`, direct Gateway HTTP/WebSocket calls, or renderer-owned transport switching
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or mutating symbol/workspace operation
  - telemetry containing raw candidate text, raw prompt, model message, provider payload, tool output, secret, auth header, trace raw body, Gateway payload, checkpoint body, lifecycle raw text, or operator dashboard production signal
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission.
  - runtime.agentMap.promptCandidateControlledCutoverPilot remains default off by omission.
  - runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot remains default off by omission.
  - runtime.agentMap.provider remains separate and default off.
rollback:
  - Disable any AgentMap prompt candidate flag to restore legacy TaskLoop reviewer prompt byte parity.
  - Omit explicit invocation, omit AgentMapResult, pass an invalid or malformed AgentMapResult, use prompt-present exclusions, or exhaust the candidate budget to fail closed with legacy reviewer prompt bytes.
  - No candidate/shadow/replay cleanup is required because AgentMap component boundary hardening must not add persistence.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-component-boundary-hardening.test.ts tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "AGENTMAP_COMPONENT_BOUNDARY_SENTINEL_DO_NOT_LEAK|AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_SENTINEL_DO_NOT_LEAK|AGENTMAP_IMPLEMENTATION_READY_SENTINEL_DO_NOT_LEAK|AGENTMAP_IMPLEMENTATION_SPEC_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_DEEP_VALIDATION_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - node scripts/scan-pattern.mjs --pattern "raw candidate|raw prompt|model message|provider payload|tool output|secret|auth header|trace raw body|Gateway payload|checkpoint body|lifecycle raw text" docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - node scripts/scan-pattern.mjs --pattern "default-on|default cutover|production-ready|accepted_line_b_agentmap_component_boundary_hardened_development_pause_recommended_default_on_still_forbidden|needs_follow_up|blocked" harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|production entry|limited production opt-in|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - Handoff includes README, component contract, boundary stop line, authority denylist, allowed surfaces, forbidden surfaces, rollback and fail-closed proof, leakage proof, provider-ordering proof, persistence proof, telemetry boundary, future-work denylist, validation results, and synthesis.
  - Component contract states AgentMap is readonly, bounded, explicit, diagnostics-only, non-authoritative, non-persistent, and pause-ready.
  - Focused tests prove default-off legacy parity 100 percent, fail-closed invalid/missing/malformed/gated-off cases 100 percent, rollback gate closure 100 percent, leakage_count 0, provider_ordering_drift 0, default reviewer prompt byte drift 0, candidate persistence 0, renderer direct IPC/Gateway 0, new service/listener/database/server 0, and authority escalation 0.
  - `Status: accepted_line_b_agentmap_component_boundary_hardened_development_pause_recommended_default_on_still_forbidden` is allowed only if every required proof passes, score is at least 95, default-on remains no, default cutover remains no, production-ready remains no, and the synthesis recommends pausing AgentMap capability expansion rather than entering runtime implementation execution.
  - Otherwise synthesis must remain `Status: needs_follow_up` or `Status: blocked`.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Component Boundary Hardening

This task hardens AgentMap into a mature, pause-ready component boundary. It does not enable default-on, approve default cutover, declare production-ready status, change default runtime behavior, change the default TaskLoop reviewer prompt, change provider ordering, persist candidate output, add services, add renderer transport bypasses, or grant AgentMap authority.
