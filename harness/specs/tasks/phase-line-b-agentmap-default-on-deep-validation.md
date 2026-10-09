---
id: phase-line-b-agentmap-default-on-deep-validation
title: Line B AgentMap Default-On Deep Validation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Produce an auditable default-on proposal readiness assessment for Line B AgentMap after limited production opt-in acceptance, without enabling default-on, approving default cutover, or declaring production-ready status.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md
  - runtime-research/handoffs/line-b-agentmap-default-on-deep-validation/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md
  - runtime-research/handoffs/line-b-agentmap-default-on-deep-validation/**
  - runtime-research/agent-runtime-index.md
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
  - This task is default-on proposal readiness deep validation only, not default-on implementation.
  - AgentMap remains default-off by omission; default-on and default cutover remain forbidden.
  - No production opt-in UI is added.
  - Default runtime behavior and default TaskLoop reviewer prompt bytes remain unchanged.
  - Provider ordering remains unchanged and AgentMap is not registered as a default provider.
  - Candidate text may enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` when all gates are explicitly enabled, explicit invocation is true, and an explicit valid AgentMapResult is supplied.
  - Candidate, shadow, and replay output remain non-persistent diagnostics owned by the caller.
  - AgentMap receives no runtime, tool, security, approval, retry, completion, provider, model, Gateway, TaskLoop, provider-ordering, or runtime decision authority.
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
  - changing provider ordering, default provider registration, automatic provider enablement, or provider/model routing
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
  - Omit explicit invocation, omit AgentMapResult, pass an invalid AgentMapResult, use prompt-present exclusions, or exhaust the candidate budget to fail closed with legacy reviewer prompt bytes.
  - No candidate/shadow/replay cleanup is required because this task must not add persistence.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_DEEP_VALIDATION_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - node scripts/scan-pattern.mjs --pattern "default-on|default cutover|production-ready|ready_for_default_on_proposal|needs_follow_up|blocked" harness/specs/tasks/phase-line-b-agentmap-default-on-deep-validation.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|production entry|limited production opt-in|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - Handoff includes README, validation plan, logic matrix, replay corpus, replay results, leakage proof, provider-ordering proof, rollback drill report, performance/noise scorecard, security/authority boundary, default-on risk register, proposal readiness review, production veto gates, and synthesis.
  - Replay/internal corpus has at least 100 cases covering all AgentMap flags omitted/off/on combinations, explicitInvocation true/false, AgentMapResult valid/invalid/missing, budget normal/exhausted/near-limit, prompt present/absent, provider-ordering-sensitive case, checkpoint/lifecycle-sensitive case, long-context case, multi-file case, failed/blocked task case, runtime shadow enabled/disabled, controlled cutover pilot enabled/disabled, TaskLoop explicit invocation pilot enabled/disabled, every gate rollback, malformed candidate text, candidate sentinel text, production-entry sentinel text, and default-on sentinel text.
  - Focused tests prove default-off legacy parity 100 percent, fail-closed invalid/missing/gated-off cases 100 percent, rollback drill 100 percent, candidate leakage 0, provider_ordering_drift 0, default reviewer prompt byte drift 0, candidate text absent from default prompts/model messages/Gateway/provider transport/checkpoint/lifecycle payloads, candidate/shadow/replay output non-persistent, and AgentMap authority escalation 0.
  - Required tests, typecheck, harness context/validate, scans, rollback drill, leakage proof, provider-ordering proof, performance/noise review, and veto gates are recorded.
  - `Status: ready_for_default_on_proposal` is allowed only if all evidence passes, score is at least 95, and no veto fires; otherwise synthesis must remain `Status: needs_follow_up` or `Status: blocked`.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Default-On Deep Validation

This task validates whether Line B AgentMap is ready to propose default-on in a future independent implementation task. It does not enable default-on, approve default cutover, declare production-ready status, add production opt-in UI, change default runtime behavior, change provider ordering, persist candidate output, or grant AgentMap authority.
