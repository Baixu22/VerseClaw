---
id: phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation
title: Line B AgentMap prompt candidate TaskLoop explicit invocation deep validation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Deeply validate the accepted TaskLoop explicit invocation pilot with boundary tightening, replay cases, quantitative scoring, and a readiness recommendation while keeping AgentMap default-off, explicit-only, non-authoritative, non-persistent, and outside provider/model/Gateway/default prompt paths.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/task-loop-controller.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/runtime-agent-map-context-provider.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - AgentMap remains default-off by omission and must not become production-ready or default-on.
  - Default TaskLoop reviewer prompt bytes remain unchanged when flags are omitted, any gate is closed, or explicit invocation is false.
  - Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid AgentMapResult.
  - Invalid/missing input, budget exhaustion, prompt-present exclusion, empty candidate output, and rollback of any gate fail closed to legacy reviewer prompt bytes with diagnostics.
  - Candidate text must not enter default prompts, model messages, Gateway requests, provider transport, lifecycle/checkpoint default payloads, or provider ordering.
  - Candidate/replay output remains in-memory caller-owned evidence only and is not persisted, cached, discovered, rebuilt, or reused by TaskLoop.
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
  - default-on AgentMap behavior, default TaskLoop pilot invocation, production-ready claim, provider ordering cutover, default provider registration, or automatic provider enablement
  - AgentMap candidate text entering default prompts, model messages, Gateway requests, provider transport, chat prompts, user prompts, system prompts, checkpoint payloads, or lifecycle default payloads
  - changing default prompt assembly text/order or TaskLoop default reviewer prompt text
  - AgentMap output becoming runtime, tool, security, approval, retry, completion-gate, provider-ordering, Gateway, model-message, or TaskLoop decision authority
  - automatic AgentMap discovery or AgentMapResult construction, caching, reuse, persistence, localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis writes, or createWriteStream for candidate/replay output
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission and remains required.
  - runtime.agentMap.promptCandidateControlledCutoverPilot remains default off by omission and remains required.
  - runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot remains default off by omission and remains required.
  - runtime.agentMap.provider remains separate from prompt candidate pilots and must remain default-off.
rollback:
  - Disable runtime.agentMap.promptAssemblyExperiment, promptCandidateRuntimeShadow, promptCandidateControlledCutoverPilot, or promptCandidateTaskLoopExplicitInvocationPilot to restore legacy TaskLoop reviewer prompt byte parity immediately.
  - Omit explicit TaskLoop pilot invocation to keep formatTaskLoopContextPackForReviewer output byte-identical.
  - Omit or invalidate explicit AgentMapResult injection to keep the TaskLoop pilot surface legacy-only.
  - Keep AgentMap provider registration omitted and keep context provider ordering unchanged.
  - No candidate/replay disk cleanup is required because no candidate/replay output is persisted.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <agentmap-deep-validation-touched-files>
  - rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-deep-validation-touched-files>
  - rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover" <agentmap-deep-validation-touched-files>
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-deep-validation-touched-files>
  - rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|deep validation" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - The new task spec validates.
  - Phase 8, Phase 9, Phase 10, Phase 11, and Phase 12 AgentMap syntheses remain accepted, and the runtime index records the accepted markers.
  - Hard gates are recorded pass/fail with evidence.
  - Replay cases cover flags off, partial gates, explicitInvocation=false, missing/invalid AgentMapResult, budget exhaustion, prompt-present exclusion, empty candidate output, rollback per gate, sentinel leakage, provider ordering, lifecycle/checkpoint default payload scan, path normalization, repeated invocation determinism, and large candidate fail-closed/no silent truncate.
  - Quantitative scorecard records category scores out of 100 and readiness threshold decision.
  - Required focused tests, typecheck, scans, and comms replay/compare decision pass or are explicitly blocked with reason.
  - synthesis.md starts as `Status: needs_revision` and changes to `Status: accepted` only after required validation and scoring pass.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Deep Validation

This task validates the accepted TaskLoop explicit invocation pilot. It may add focused tests, replay cases, and handoff evidence. It must not widen runtime invocation, make AgentMap default-on, change provider ordering, persist candidate output, or move candidate text into any default prompt/model/Gateway/provider path.
