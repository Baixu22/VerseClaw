---
id: phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof
title: Line B AgentMap prompt candidate TaskLoop Phase A replay proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the accepted AgentMap TaskLoop explicit invocation pilot with real or near-real replay samples while keeping AgentMap default-off, explicit-only, non-authoritative, non-persistent, and outside provider/model/Gateway/default prompt paths.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - AgentMap remains default-off by omission and is not production-ready, default-on, or approved for default cutover.
  - The explicit TaskLoop pilot requires all four AgentMap prompt candidate gates, explicit invocation, and an explicit valid AgentMapResult.
  - Default TaskLoop reviewer prompt bytes remain unchanged when any gate is omitted or closed, explicit invocation is false, or AgentMapResult is missing or invalid.
  - Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface.
  - Candidate text must not enter default prompts, model messages, Gateway requests, provider transport, lifecycle/checkpoint default payloads, provider ordering, or default TaskLoop decisions.
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
  - describing the current pilot as production-ready, default-on, default cutover, or ready for production default behavior
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
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <agentmap-taskloop-replay-proof-touched-files>
  - rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-taskloop-replay-proof-touched-files>
  - rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on" <agentmap-taskloop-replay-proof-touched-files>
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-taskloop-replay-proof-touched-files>
  - rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Replay Proof|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - Production-readiness synthesis is accepted with score at least 95 and recommends Phase A Replay Proof.
  - Runtime index records the production-readiness accepted marker before replay-proof index update.
  - Deep validation synthesis remains accepted and Phase 8/9/10/11/12 AgentMap syntheses remain accepted.
  - AgentMap remains default-off and candidate text still only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`.
  - The handoff includes README, replay corpus, replay proof matrix, deterministic replay proof, leakage sentinel proof, provider ordering proof, rollback proof, quantitative replay scorecard, validation plan, submission template, and synthesis.
  - Replay proof covers successful, failed, blocked, long context, large candidate set, budget exhausted, empty candidate, prompt-present files, missing AgentMapResult, invalid AgentMapResult, explicitInvocation=false, one gate closed, each gate rollback, Windows/POSIX path normalization, candidate sentinel leakage, lifecycle/checkpoint default payload scan, provider ordering snapshot, and repeated replay deterministic output.
  - Proof records default-off legacy byte parity drift 0, candidate leakage 0, provider ordering drift 0, default runtime behavior drift 0, every failure path fail closed, rollback by any gate 100%, deterministic replay, no persistence, no automatic discovery/cache/reuse, and no authority escalation.
  - Quantitative replay scorecard uses Replay corpus coverage 25, Determinism 15, Default behavior parity 20, Boundary/no authority/no leakage 20, Fail-closed and rollback 15, and Maintainability/auditability 5.
  - Required focused tests, typecheck, scans, and comms replay/compare decision pass or are explicitly blocked with reason.
  - synthesis.md starts as `Status: needs_revision` and changes to `Status: accepted` only after required validation and scoring pass.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/README.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/replay-corpus.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/replay-proof-matrix.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/deterministic-replay-proof.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/leakage-sentinel-proof.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/provider-ordering-proof.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/rollback-proof.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/quantitative-replay-scorecard.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/validation-plan.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/submission-template.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-replay-proof/synthesis.md
---

# Line B AgentMap Prompt Candidate TaskLoop Phase A Replay Proof

This task proves the accepted explicit TaskLoop pilot with replay evidence only. It may add specs and handoff evidence. It must not widen runtime invocation, make AgentMap default-on, change provider ordering, persist candidate output, or move candidate text into any default prompt/model/Gateway/provider path.
