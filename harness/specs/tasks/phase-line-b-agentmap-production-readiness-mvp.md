---
id: phase-line-b-agentmap-production-readiness-mvp
title: Line B AgentMap Production Readiness MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Decide whether the accepted AgentMap TaskLoop explicit invocation pilot can enter controlled internal opt-in while keeping AgentMap default-off, explicit-only, non-authoritative, non-persistent, and outside default runtime, provider, model, Gateway, and prompt paths.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
  - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
  - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
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
  - AgentMap remains default-off by omission and is not approved as production-ready, default-on, or default cutover.
  - Controlled internal opt-in requires all AgentMap prompt candidate gates, explicit TaskLoop invocation, and an explicit valid AgentMapResult.
  - Default TaskLoop reviewer prompt bytes remain unchanged when flags are omitted, any gate is closed, explicit invocation is false, or explicit AgentMapResult is missing or invalid.
  - Candidate text may enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` and must not enter default prompts, model messages, Gateway requests, provider transport, lifecycle payloads, checkpoint payloads, or provider ordering.
  - Real traffic shadow evidence is diagnostics-only, in-memory/caller-owned, default-off, and cannot influence runtime, tool, security, approval, retry, completion, provider, model, or Gateway decisions.
  - Limited production opt-in and default-on are future planning artifacts only and are not approved by this task.
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
  - default-on AgentMap behavior, production-ready claim, default cutover claim, provider ordering cutover, default provider registration, or automatic provider enablement
  - AgentMap candidate text entering default prompts, model messages, Gateway requests, provider transport, chat prompts, user prompts, system prompts, checkpoint payloads, or lifecycle default payloads
  - changing default prompt assembly text/order or TaskLoop default reviewer prompt text
  - AgentMap output becoming runtime, tool, security, approval, retry, completion-gate, provider-ordering, Gateway, model-message, or TaskLoop decision authority
  - automatic AgentMap discovery or AgentMapResult construction, caching, reuse, persistence, localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis writes, or createWriteStream for candidate/shadow/replay output
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
  - Disable any AgentMap prompt candidate gate to restore legacy TaskLoop reviewer prompt byte parity.
  - Omit explicit TaskLoop pilot invocation or explicit valid AgentMapResult to keep legacy reviewer prompt bytes.
  - Keep AgentMap provider registration omitted and context provider ordering unchanged.
  - No candidate/shadow/replay cleanup is required because candidate text and shadow outputs are not persisted by this task.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-production-readiness-mvp.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_MVP_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <agentmap-production-mvp-touched-files>
  - rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-production-mvp-touched-files>
  - rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on|default cutover" <agentmap-production-mvp-touched-files>
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-production-mvp-touched-files>
  - rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Production Readiness MVP|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
acceptance:
  - Prerequisite check confirms Phase A Replay Proof, Deep Validation, Production Readiness Plan, and Phase 8/9/10/11/12/13 AgentMap syntheses are accepted.
  - Runtime index records the Phase A accepted marker before implementation.
  - AgentMap remains default-off and candidate text can enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`.
  - Handoff includes README, cutover readiness review, real shadow MVP plan/evidence, controlled internal opt-in plan, quality scorecard, production veto gates, security authority boundary, observability diagnostics plan, limited production opt-in plan, default-on proposal template, rollback playbook, validation plan, submission template, and synthesis.
  - `synthesis.md` starts as `Status: needs_revision` and changes to `Status: accepted_for_controlled_internal_opt_in` only after required validation passes, all hard gates pass, and no veto gate fires.
  - Runtime index is updated only after `synthesis.md` reaches `Status: accepted_for_controlled_internal_opt_in`.
  - Required focused tests, typecheck, scans, and comms replay/compare decision pass or are explicitly recorded with reason.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/README.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/cutover-readiness-review.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/real-shadow-mvp-plan.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/controlled-internal-opt-in-plan.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/quality-scorecard.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/production-veto-gates.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/security-authority-boundary.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/observability-diagnostics-plan.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/limited-production-opt-in-plan.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/default-on-proposal-template.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/rollback-playbook.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/validation-plan.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/submission-template.md
    - runtime-research/handoffs/line-b-agentmap-production-readiness-mvp/synthesis.md
---

# Line B AgentMap Production Readiness MVP

This task produces the Phase B readiness package for controlled internal opt-in. It must preserve default runtime behavior and may not approve production default behavior.
