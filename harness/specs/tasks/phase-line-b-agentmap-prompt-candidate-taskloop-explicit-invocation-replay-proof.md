---
id: phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof
title: Line B AgentMap prompt candidate TaskLoop explicit invocation Phase A replay proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the accepted explicit TaskLoop pilot with a broader replay corpus while keeping AgentMap default-off, explicit-only, non-authoritative, non-persistent, and outside provider/model/Gateway/default prompt paths.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof/**
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
  - AgentMap remains default-off by omission and is not production-ready, default-on, or approved for default cutover.
  - Default TaskLoop reviewer prompt bytes remain unchanged when flags are omitted, any gate is closed, explicit invocation is false, or explicit AgentMapResult is missing or invalid.
  - Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all four gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid AgentMapResult.
  - Successful, failed, blocked, long-context, and multi-file ClawX-like TaskLoop replay shapes preserve default reviewer prompt parity unless explicitly invoked.
  - Invalid/missing input, budget exhaustion, large candidate overflow, prompt-present exclusion, empty candidate output, and rollback of any gate fail closed to legacy reviewer prompt bytes with diagnostics.
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
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-replay-proof.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on|default cutover" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Replay Proof|production readiness|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - The prerequisite check confirms deep validation synthesis is accepted, production-readiness synthesis is accepted, the runtime index records both accepted markers, Phase 8/9/10/11/12 AgentMap syntheses remain accepted, AgentMap remains default-off, and explicit pilot candidate text still only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`.
  - The handoff includes README, replay proof plan, replay corpus, replay results, boundary proof, leakage proof, provider ordering proof, rollback proof, quantitative scorecard, validation plan, submission template, and synthesis.
  - Replay corpus covers flags off, one gate, first two gates, first three gates, explicitInvocation=false, missing AgentMapResult, invalid AgentMapResult, budget 0, large candidate overflow/no silent truncate, prompt-present file, Windows prompt-present path, POSIX prompt-present path, empty candidate, successful TaskLoop replay, failed TaskLoop replay, blocked TaskLoop replay, long context replay, multi-file ClawX-like replay, repeated invocation determinism, rollback per gate, candidate sentinel leakage, default reviewer prompt byte parity, lifecycle/checkpoint default payload scan, model/Gateway/provider transport scan, provider ordering snapshot, no disk persistence, no renderer direct IPC/direct Gateway, and no automatic discovery/build/cache/reuse.
  - Hard gates are recorded pass/fail with evidence.
  - Quantitative scorecard records category scores out of 100 and readiness threshold decision.
  - Required focused tests, typecheck, scans, and comms replay/compare decision pass or are explicitly blocked with reason.
  - synthesis.md starts as `Status: needs_revision` and changes to `Status: accepted` only after required validation and scoring pass.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Phase A Replay Proof

This task proves the accepted explicit TaskLoop pilot with a broader replay corpus. It may add focused tests, replay fixtures, and handoff evidence. It must not widen runtime invocation, make AgentMap default-on, change provider ordering, persist candidate output, or move candidate text into any default prompt/model/Gateway/provider path.
