---
id: phase-line-b-agentmap-production-entry-readiness
title: Line B AgentMap Production Entry Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Produce the auditable production-entry readiness package after Phase B accepted controlled internal opt-in, deciding whether AgentMap may advance to limited production opt-in while keeping default-on and default cutover explicitly forbidden.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
  - runtime-research/handoffs/line-b-agentmap-production-entry-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
  - runtime-research/handoffs/line-b-agentmap-production-entry-readiness/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-production-entry-readiness.test.ts
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
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
expectedUserBehavior:
  - AgentMap remains default-off by omission and is not approved as production-ready, default-on, or default cutover.
  - Limited production opt-in can be recommended only when Phase B, Phase A, Deep Validation, Production Readiness Plan, internal samples, rollback drill, leakage proof, provider-ordering proof, and required validation pass.
  - Default TaskLoop reviewer prompt bytes remain unchanged when flags are omitted, any gate is closed, explicit invocation is false, explicit AgentMapResult is missing or invalid, or candidate budget is exhausted.
  - Candidate text may enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` under all gates, explicit invocation, and explicit valid AgentMapResult.
  - Candidate text must not enter default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, lifecycle payloads, checkpoint payloads, provider ordering, or runtime decisions.
  - Candidate, shadow, and replay output remains non-persistent, caller-owned, diagnostics-only evidence with no automatic discovery, build, cache, or reuse.
  - AgentMap receives no runtime, tool, security, approval, retry, completion, provider, model, Gateway, provider-ordering, or TaskLoop decision authority.
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
  - approving production default-on, default cutover, production-ready status, default provider registration, provider ordering cutover, automatic provider enablement, or production opt-in UI
  - AgentMap candidate text entering default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, chat prompts, user prompts, system prompts, checkpoint payloads, or lifecycle payloads
  - changing default prompt assembly text/order or TaskLoop default reviewer prompt text
  - AgentMap output becoming runtime, tool, security, approval, retry, completion-gate, provider-ordering, Gateway, model-message, or TaskLoop decision authority
  - automatic AgentMap discovery, AgentMapResult construction, cache, reuse, persistence, localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis writes, sidecars, queues, or createWriteStream for candidate/shadow/replay output
  - new service, listener, daemon, external database, HTTP server, WebSocket server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission.
  - runtime.agentMap.promptCandidateControlledCutoverPilot remains default off by omission.
  - runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot remains default off by omission.
  - runtime.agentMap.provider remains separate from prompt candidate pilots and must remain default-off.
rollback:
  - Disable runtime.agentMap.promptAssemblyExperiment to restore legacy TaskLoop reviewer prompt byte parity.
  - Disable runtime.agentMap.promptCandidateRuntimeShadow to restore legacy TaskLoop reviewer prompt byte parity.
  - Disable runtime.agentMap.promptCandidateControlledCutoverPilot to restore legacy TaskLoop reviewer prompt byte parity.
  - Disable runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot to restore legacy TaskLoop reviewer prompt byte parity.
  - Omit explicit TaskLoop invocation, omit AgentMapResult, pass an invalid AgentMapResult, or exhaust the candidate budget to fail closed with legacy prompt bytes.
  - No candidate/shadow/replay cleanup is required because this task must not add persistence.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-production-entry-readiness.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <agentmap-production-entry-touched-files>
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-production-entry-touched-files>
  - node scripts/scan-pattern.mjs --pattern "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on|default cutover" <agentmap-production-entry-touched-files>
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-production-entry-touched-files>
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|production entry|limited production opt-in|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - Prerequisite check confirms Phase B Production Readiness MVP is `Status: accepted_for_controlled_internal_opt_in`, runtime index records the Phase B marker, Phase A Replay Proof is accepted, Deep Validation is accepted, Production Readiness Plan is accepted, AgentMap remains default-off, candidate text remains only in `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`, default runtime behavior is unchanged, default TaskLoop reviewer prompt is unchanged, and provider ordering is unchanged.
  - Handoff includes README, prerequisite check, controlled internal opt-in execution plan, internal sample corpus, internal sample results, limited production readiness review, scorecard, veto gates, security/authority boundary, leakage proof, provider-ordering proof, rollback drill report, observability metrics plan, privacy/retention boundary, operator runbook, limited production opt-in spec draft, default-on blocker register, validation plan, submission template, and synthesis.
  - Internal sample corpus defines at least 30 realistic internal task samples covering successful, failed, blocked, long-context, multi-file, large-candidate, budget-exhausted, prompt-present, invalid-result, gate rollback, provider-ordering-sensitive, and lifecycle/checkpoint-sensitive cases.
  - Internal sample results record pass/fail, coverage, candidate relevance, noise rate, token cost, latency cost, fail-closed rate, leakage count, provider-ordering drift, rollback success, evidence source, and known gaps for every sample.
  - Hard gates pass for default-off behavior, default runtime parity, default reviewer prompt byte identity, rollback parity, fail-closed invalid/missing/budget cases, candidate boundary, non-persistence, provider ordering, renderer/Gateway boundary, service/listener/database boundary, no automatic discovery/cache/reuse, and no authority escalation.
  - Veto gates do not fire, including leakage_count > 0, provider_ordering_drift > 0, fail-closed rate below 100 percent for invalid/missing/gated-off cases, rollback drill failure, default prompt drift, candidate persistence, renderer direct IPC/Gateway, new service/listener/database/server, or approving default-on/default cutover.
  - Scorecard totals at least 95/100 before `Status: accepted_for_limited_production_opt_in` and records each category score.
  - Rollback drill passes 100 percent for promptAssemblyExperiment off, promptCandidateRuntimeShadow off, promptCandidateControlledCutoverPilot off, promptCandidateTaskLoopExplicitInvocationPilot off, explicitInvocation=false, missing AgentMapResult, invalid AgentMapResult, and budget exhausted.
  - Required focused tests, typecheck, harness context/validate, scans, and comms replay/compare decision pass or are explicitly recorded with clean overlay proof and blocked/skipped reasons.
  - `synthesis.md` starts as `Status: needs_revision` and changes to `Status: accepted_for_limited_production_opt_in` only after required validation passes; runtime index updates only after that accepted status.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Production Entry Readiness

This task produces the production-entry readiness package after Phase B accepted controlled internal opt-in. It may recommend limited production opt-in only when the documented evidence, tests, scans, rollback drill, and veto gates pass. It must not approve default-on AgentMap, default cutover, production-ready status, production UI, provider ordering changes, persistence, automatic discovery, or any AgentMap runtime authority.
