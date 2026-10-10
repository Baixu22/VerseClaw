---
lifecycleStatus: archived
id: phase-line-b-agentmap-default-on-implementation-spec
title: Line B AgentMap Default-On Implementation Spec
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Produce the auditable default-on implementation specification and gap-closure package for Line B AgentMap without enabling default-on, approving default cutover, or declaring production-ready status.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md
  - runtime-research/handoffs/line-b-agentmap-default-on-implementation-spec/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md
  - runtime-research/handoffs/line-b-agentmap-default-on-implementation-spec/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - tests/unit/runtime-agent-map-production-entry-readiness.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
expectedUserBehavior:
  - This task is default-on implementation spec and gap closure only; it is not default-on enablement.
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
  - The implementation spec may define future default-on enablement steps, but this task must not execute those steps.
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
  - changing provider ordering, default provider registration, automatic provider enablement, provider/model routing, Gateway transport, or transport policy
  - AgentMap candidate text entering default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, chat prompts, user prompts, system prompts, checkpoint payloads, lifecycle payloads, provider ordering, or runtime decisions
  - candidate, shadow, or replay output persistence through localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis, sidecars, queues, fs writes, createWriteStream, cache, reuse, or automatic discovery
  - new service, listener, daemon, database, WebSocket server, HTTP server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct `window.electron.ipcRenderer.invoke(...)`, direct Gateway HTTP/WebSocket calls, or renderer-owned transport switching
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or mutating symbol/workspace operation
  - telemetry containing raw candidate text, raw prompt, model message, provider payload, tool output, secret, auth header, trace raw body, Gateway payload, checkpoint body, or lifecycle raw text
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
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK|AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_SENTINEL_DO_NOT_LEAK|AGENTMAP_IMPLEMENTATION_READY_SENTINEL_DO_NOT_LEAK|AGENTMAP_IMPLEMENTATION_SPEC_SENTINEL_DO_NOT_LEAK|AGENTMAP_DEFAULT_ON_DEEP_VALIDATION_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - node scripts/scan-pattern.mjs --pattern "raw candidate|raw prompt|model message|provider payload|tool output|secret|auth header|trace raw body|Gateway payload|checkpoint body|lifecycle raw text" docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - node scripts/scan-pattern.mjs --pattern "default-on|default cutover|production-ready|accepted_line_b_agentmap_default_on_implementation_spec_gap_closure_default_on_still_forbidden|needs_follow_up|blocked" harness/specs/tasks/phase-line-b-agentmap-default-on-implementation-spec.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|production entry|limited production opt-in|controlled internal opt-in|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md README.ru-RU.md
acceptance:
  - Handoff includes README, implementation spec, telemetry implementation plan, telemetry privacy boundary, rollback drill plan, rollback drill results, default-path parity proof, leakage proof, provider-ordering proof, persistence proof, authority boundary proof, comms regression decision, UI/docs/i18n decision, rollout gates, production veto gates, operator runbook, implementation risk register, validation results, and synthesis.
  - Implementation spec defines the smallest future default-on implementation execution steps, telemetry counters, rollback gates, validation gates, and operator actions while explicitly forbidding this task from executing those future steps.
  - Focused tests prove default-off legacy parity 100 percent, fail-closed invalid/missing/malformed/gated-off cases 100 percent, rollback gate closure 100 percent, leakage_count 0, provider_ordering_drift 0, default reviewer prompt byte drift 0, candidate persistence 0, authority escalation 0, telemetry payload contains no raw candidate/prompt/provider/model/Gateway/checkpoint/lifecycle text, default-on implementation spec exists but default-on remains disabled, and default cutover remains unapproved.
  - Required tests, typecheck, harness context/validate, scans, rollback drill, leakage proof, provider-ordering proof, persistence proof, authority boundary proof, telemetry privacy proof, performance/noise review, docs/i18n review, comms decision, and veto gates are recorded.
  - `Status: accepted_line_b_agentmap_default_on_implementation_spec_gap_closure_default_on_still_forbidden` is allowed only if every required proof passes, score is at least 95, and no hard veto fires; otherwise synthesis must remain `Status: needs_follow_up` or `Status: blocked`.
  - Default-on allowed is no, default cutover allowed is no, and production-ready is no in the final synthesis.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Default-On Implementation Spec

This task writes the implementation specification and closes planning gaps for a future default-on AgentMap implementation. It does not enable default-on, approve default cutover, declare production-ready status, change default runtime behavior, change the default TaskLoop reviewer prompt, change provider ordering, persist candidate output, add services, add renderer transport bypasses, or grant AgentMap authority.
