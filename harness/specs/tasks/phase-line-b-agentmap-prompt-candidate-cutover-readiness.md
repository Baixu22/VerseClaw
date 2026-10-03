---
id: phase-line-b-agentmap-prompt-candidate-cutover-readiness
title: Line B AgentMap prompt candidate cutover readiness spec
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the evidence gates required before any future AgentMap prompt candidate cutover proposal can be considered, without implementing cutover or inserting AgentMap candidate text into prompts, model messages, Gateway payloads, provider transport, or runtime authority paths.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/runtime-agent-map-context-provider.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - This phase is spec-only/readiness-only. It does not approve or implement prompt cutover.
  - Previous AgentMap prompt candidate runtime shadow pilot and replay proof remain accepted as default-off diagnostics/stability evidence only.
  - AgentMap remains default-off, readonly, explicit-input only, diagnostics-only, and non-authoritative.
  - Enabling existing runtime shadow diagnostics still requires both runtime.agentMap.promptAssemblyExperiment and runtime.agentMap.promptCandidateRuntimeShadow to be true plus explicit valid AgentMapResult input.
  - runtime.agentMap.provider remains separate, explicit, and default-off. createContextProviderRegistryPilot() default ordering remains legacy-context-engine followed by loop-context-pack.
  - Default prompt assembly text/order, TaskLoop reviewer prompts, system prompts, user prompts, chat prompts, model messages, Gateway requests, provider transport, provider ordering, and TaskLoop decisions remain unchanged.
  - AgentMap candidate/replay output is not persisted to disk and candidate text is not stored in runtime shadow reports.
  - Any future prompt cutover requires a new implementation task spec and a later accepted synthesis after this readiness spec.
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
  - prompt cutover, candidate cutover, default-on AgentMap behavior, automatic AgentMap provider registration, provider ordering cutover, or automatic provider enablement
  - adding AgentMap candidate text to default prompt assembly, TaskLoop prompt, reviewer prompt, Gateway request, model messages, provider transport, chat prompts, user prompt, or system prompt
  - changing default prompt assembly text or ordering
  - AgentMap output becoming authoritative runtime context, prompt context, completion evidence, retry policy, security policy, approval policy, tool permission policy, tool selection policy, provider-ordering policy, Gateway policy, model-message policy, or TaskLoop decision input
  - automatic AgentMap discovery from TaskLoop or runtime shadow paths
  - changing buildAgentMapPromptCandidateRuntimeShadowReport behavior or assembleAgentMapPromptAssemblyExperimentCandidate behavior in this phase
  - changing TaskLoop runtime behavior, config schema, default flags, or adding runtime flags
  - candidate persistence, replay persistence, disk persistence, localStorage, indexedDB, electron-store, SQLite/Postgres/MySQL/Redis persistence, or createWriteStream for AgentMap candidate/replay output
  - replacing, wrapping, disabling, deprecating, or discouraging default read, grep, find, or ls behavior
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - user-visible UI changes or README translation edits unless docs-sync scan proves a public behavior/docs update is required
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission and enables diagnostics only when promptAssemblyExperiment is also true.
  - runtime.agentMap.provider remains separate from prompt candidate runtime shadowing and remains default-off.
rollback:
  - Disable runtime.agentMap.promptCandidateRuntimeShadow and runtime.agentMap.promptAssemblyExperiment to restore legacy prompt behavior immediately.
  - Omit explicit AgentMapResult injection and any optional AgentMap extra provider registration.
  - Preserve legacy context engine, loop context pack, TaskLoop, Gateway, provider transport, provider ordering, prompt assembly, and renderer/Main boundaries as authoritative.
  - Preserve caller-owned memory-only AgentMap results as discardable inputs; do not create or delete persisted AgentMap candidate/replay data.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-cutover-readiness.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck unless no TS/JS/JSON code changed and the synthesis documents the skip
  - rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
  - rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-cutover-readiness-touched-files>
  - rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-cutover-readiness-touched-files>
  - rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover" <agentmap-cutover-readiness-touched-files>
  - rg -n "writeFile|appendFile|mkdir|rm\(|unlink|createWriteStream|fs\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-cutover-readiness-touched-files>
  - rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
  - pnpm --config.verify-deps-before-run=false run comms:replay and pnpm --config.verify-deps-before-run=false run comms:compare only if Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths are touched
acceptance:
  - The new task spec validates.
  - Previous runtime shadow pilot synthesis remains accepted.
  - Previous replay proof synthesis remains accepted.
  - This phase remains spec-only/readiness-only with no runtime behavior changes.
  - No config schema changes, no default-on AgentMap behavior, no default provider registration, and no provider ordering change are introduced.
  - No prompt/model/Gateway/provider transport cutover is introduced.
  - Candidate text does not enter TaskLoop prompts, reviewer prompts, Gateway, model messages, provider transport, user prompt, chat prompts, or system prompt.
  - AgentMap candidate/replay output is not persisted to disk.
  - No automatic AgentMap discovery from TaskLoop is introduced.
  - No mutation/apply/edit surface, service/listener/daemon/database, renderer IPC bypass, or renderer direct Gateway call is added.
  - Lanes A-E exist and each contains scope, accepted inputs, forbidden outputs, required proof, rollback condition, and validation commands/scans.
  - Future cutover requirements are explicit, testable, and gated behind a new implementation spec.
  - synthesis.md is accepted only after validation passes; runtime-research/agent-runtime-index.md is updated only after synthesis is accepted.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Candidate Cutover Readiness Spec

This task defines the proof required before any future AgentMap prompt candidate cutover proposal may be drafted. It does not approve cutover and does not implement cutover.

AgentMap remains default-off, readonly, explicit-input only, diagnostics-only, and non-authoritative. Existing Phase 8/9 shadow diagnostics are evidence, not permission to insert AgentMap candidate text into prompt, model, Gateway, provider, or runtime authority paths.
