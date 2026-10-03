---
id: phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan
title: Line B AgentMap prompt candidate TaskLoop production readiness plan
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Design and validate the pre-production readiness path after accepted TaskLoop explicit invocation deep validation, including Replay Proof, cutover readiness, controlled opt-in, limited production opt-in, default-on proposal prerequisites, veto gates, rollback/operator plan, and quantitative readiness scoring while keeping AgentMap default-off, explicit-only, non-authoritative, non-persistent, and outside provider/model/Gateway/default prompt paths.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan/**
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
  - AgentMap remains default-off by omission and must not be described as production-ready, default-on, or approved for default cutover.
  - The accepted deep validation score and Replay Proof recommendation are prerequisites only; they do not approve production enablement.
  - Default TaskLoop reviewer prompt bytes remain unchanged when flags are omitted, any gate is closed, explicit invocation is false, or explicit AgentMapResult is missing or invalid.
  - Candidate text may enter only the named `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` surface when all gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid AgentMapResult.
  - Candidate text must not enter default prompts, model messages, Gateway requests, provider transport, lifecycle/checkpoint default payloads, or provider ordering.
  - Candidate/replay output remains in-memory caller-owned evidence only and is not persisted, cached, discovered, rebuilt, or reused by TaskLoop.
  - The readiness plan defines phased entry/exit criteria for Replay Proof, Cutover Readiness Review, Controlled Internal Opt-in, Limited Production Opt-in, and a future Default-on Proposal without implementing production default-on.
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
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <agentmap-production-readiness-touched-files>
  - rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-production-readiness-touched-files>
  - rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on" <agentmap-production-readiness-touched-files>
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-production-readiness-touched-files>
  - rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|production readiness|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - The prerequisite check confirms deep validation synthesis is accepted, deep validation score is at least 95, the runtime index records the deep validation accepted marker, Phase 8/9/10/11/12 AgentMap syntheses remain accepted, AgentMap remains default-off, and explicit pilot candidate text still only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`.
  - The handoff includes README, production readiness plan, Replay Proof plan, Cutover Readiness plan, Controlled Internal Opt-in plan, Production Veto Gates, Quantitative Readiness Scorecard, Rollback and Operator Plan, Validation Plan, Submission Template, and Synthesis.
  - Phase A Replay Proof covers successful, failed, blocked, long context, large candidate set, budget exhausted, empty candidate, prompt-present files, missing AgentMapResult, invalid AgentMapResult, explicitInvocation=false, one gate closed, each gate rollback, Windows/POSIX path normalization, candidate sentinel leakage, lifecycle/checkpoint default payload scan, and provider ordering snapshot.
  - Phase B Cutover Readiness Review defines future cutover gates without enabling cutover and proves zero default reviewer prompt drift, zero candidate leakage, zero provider ordering drift, zero default runtime behavior drift, rollback by any gate, no persistence, no automatic discovery/cache/reuse, and no authority escalation.
  - Phase C Controlled Internal Opt-in covers internal-only, developer-only, per-agent, per-session, allowlist workspace gates plus diagnostics, failure reporting, rollback path, and thresholds.
  - Phase D Limited Production Opt-in defines allowed scope, blocked scope, diagnostics, rollback criteria, and incident/veto criteria, and remains blocked until Replay Proof and Cutover Readiness are accepted.
  - Phase E Default-on Proposal defines prerequisites only and does not implement or approve default-on behavior.
  - Veto gates include all one-vote rejection items and are represented in the readiness decision.
  - Quantitative readiness scorecard uses Replay coverage 20, Default behavior parity 20, Boundary/no authority 20, Fail-closed and rollback 15, Diagnostics/operator readiness 10, Controlled opt-in safety 10, and Maintainability/auditability 5.
  - Required focused tests, typecheck, scans, and comms replay/compare decision pass or are explicitly blocked with reason.
  - synthesis.md starts as `Status: needs_revision` and changes to `Status: accepted` only after required validation and scoring pass.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Candidate TaskLoop Production Readiness Plan

This task designs the production-readiness path after accepted deep validation. It may add specs, handoff plans, scorecards, veto gates, validation evidence, and future-phase readiness criteria. It must not widen runtime invocation, make AgentMap default-on, change provider ordering, persist candidate output, or move candidate text into any default prompt/model/Gateway/provider path.
