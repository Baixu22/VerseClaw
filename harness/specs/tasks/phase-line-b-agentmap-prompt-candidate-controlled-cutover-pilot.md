---
lifecycleStatus: archived
id: phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot
title: Line B AgentMap prompt candidate controlled cutover pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a strictly default-off AgentMap prompt candidate controlled cutover pilot that can expose candidate text only to an explicit, named prompt assembly pilot surface after all gates are enabled and a valid AgentMapResult is supplied by the caller, while preserving legacy runtime behavior and prompt/model/Gateway/provider parity by default.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-controlled-cutover-pilot/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - tsconfig.node.json
  - tsconfig.web.json
  - tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-controlled-cutover-pilot/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-controlled-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - tsconfig.node.json
  - tsconfig.web.json
  - tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts
  - tests/unit/runtime-agent-map-context-provider.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - AgentMap remains default-off, readonly, explicit-input only, and non-authoritative.
  - Controlled cutover is not default cutover, production default enablement, provider default registration, or provider ordering cutover.
  - Candidate text enters the named controlled pilot prompt assembly surface only when runtime.agentMap.promptAssemblyExperiment, runtime.agentMap.promptCandidateRuntimeShadow, and runtime.agentMap.promptCandidateControlledCutoverPilot are all true.
  - The caller must explicitly pass a valid AgentMapResult; TaskLoop must not discover, build, or infer AgentMapResult automatically.
  - Disabling any gate, omitting/invalidating AgentMapResult, exceeding budget, or duplicating prompt-present files restores legacy prompt byte parity and emits diagnostics.
  - Default prompts, TaskLoop reviewer prompts, Gateway payloads, model messages, provider transport, provider ordering, and runtime decisions remain unchanged.
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
  - default-on AgentMap behavior, default provider registration, provider ordering cutover, or automatic provider enablement
  - AgentMap candidate text entering default prompts, TaskLoop reviewer prompts, Gateway requests, model messages, provider transport, chat prompts, user prompts, or system prompts
  - changing default prompt assembly text/order or TaskLoop default reviewer prompt text
  - AgentMap output becoming runtime, tool, security, approval, retry, completion-gate, provider-ordering, Gateway, model-message, or TaskLoop decision authority
  - automatic AgentMap discovery or AgentMapResult construction from TaskLoop
  - candidate/replay output persistence, localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis persistence, or createWriteStream for AgentMap candidate/replay output
  - replacing, wrapping, disabling, deprecating, or discouraging default read, grep, find, or ls behavior
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission and remains required.
  - runtime.agentMap.promptCandidateControlledCutoverPilot is the new explicit pilot gate and must remain default off by omission.
  - runtime.agentMap.provider remains separate from prompt candidate controlled cutover and must remain default-off.
rollback:
  - Disable runtime.agentMap.promptCandidateControlledCutoverPilot, runtime.agentMap.promptCandidateRuntimeShadow, or runtime.agentMap.promptAssemblyExperiment to restore legacy prompt byte parity immediately.
  - Omit explicit AgentMapResult injection to keep the controlled cutover surface legacy-only.
  - Omit optional AgentMap provider registration and keep createContextProviderRegistryPilot() default ordering unchanged.
  - Preserve caller-owned memory-only AgentMap results as discardable inputs; no candidate/replay data is persisted, so rollback requires no disk cleanup.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-controlled-cutover-pilot.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-controlled-cutover-touched-files>
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-controlled-cutover-touched-files>
  - node scripts/scan-pattern.mjs --pattern "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover" <agentmap-controlled-cutover-touched-files>
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\(|unlink|createWriteStream|fs\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-controlled-cutover-touched-files>
  - node scripts/scan-pattern.mjs --pattern "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
  - pnpm --config.verify-deps-before-run=false run comms:replay and pnpm --config.verify-deps-before-run=false run comms:compare only if Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths are touched
acceptance:
  - The new task spec validates.
  - Phase 8 runtime shadow pilot synthesis remains accepted.
  - Phase 9 replay proof synthesis remains accepted.
  - Phase 10 cutover readiness synthesis remains accepted.
  - Controlled cutover pilot remains default-off by omission.
  - Flags-off runtime behavior, prompt assembly, TaskLoop reviewer prompts, model messages, Gateway payloads, provider transport, and provider ordering are unchanged.
  - Candidate text enters only the named controlled pilot surface when all three gates are true and the caller explicitly supplies a valid AgentMapResult.
  - Closing any gate restores byte-identical legacy prompt behavior and emits gate-blocked diagnostics.
  - Budget failures fail closed or exclude the candidate without silent truncation.
  - Prompt-present files are excluded or diagnosed as excluded and do not duplicate existing prompt context.
  - No default provider registration, provider ordering change, AgentMap authority, automatic TaskLoop discovery, disk persistence, renderer direct IPC, or direct Gateway call is introduced.
  - Required focused tests, typecheck, scans, and comms replay/compare decision pass and are recorded.
  - synthesis.md is accepted only after validation passes; runtime-research/agent-runtime-index.md is updated only after synthesis is accepted.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Candidate Controlled Cutover Pilot

This task implements the narrow pilot that Phase 10 only planned. It is not a default cutover. It allows candidate text only inside an explicit controlled prompt assembly pilot result, with legacy text returned whenever any gate is closed or the caller omits a valid AgentMapResult.
