---
lifecycleStatus: archived
id: phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof
title: Line B AgentMap prompt candidate runtime shadow replay proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the accepted AgentMap prompt candidate runtime shadow pilot is stable under replay in pure adapter and TaskLoop contexts, remains explicit double opt-in and default-off, preserves prompt-present exclusions and budget diagnostics, and does not insert AgentMap candidate text into TaskLoop prompts, Gateway payloads, model messages, provider transport, user prompts, reviewer prompts, or system prompts.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - tests/unit/runtime-agent-map-context-provider.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/task-loop-controller.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - tests/unit/runtime-agent-map-context-provider.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - AgentMap prompt candidate runtime shadow diagnostics remain explicit opt-in and default-off by omission.
  - Enabling the replay proof path requires both runtime.agentMap.promptAssemblyExperiment and runtime.agentMap.promptCandidateRuntimeShadow to be true plus an explicit valid AgentMapResult supplied by the caller.
  - Repeated pure adapter runs with identical explicit AgentMap input produce stable report metadata, diagnostics, and authority flags, excluding only generatedAt when the caller changes it.
  - Budget and prompt-present variants affect diagnostics and report metadata only; they do not alter TaskLoop reviewer prompt text, default prompt assembly, Gateway payloads, model messages, provider transport, provider ordering, or runtime decisions.
  - AgentMap remains readonly, diagnostic, explicit-input only, non-authoritative, and absent from default provider registration.
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
  - TaskLoop prompt cutover, reviewer prompt cutover, Gateway cutover, provider transport cutover, model-message cutover, chat prompt cutover, user prompt cutover, system prompt cutover, or default prompt assembly cutover
  - AgentMap output becoming authoritative runtime context, prompt context, completion evidence, retry policy, security policy, approval policy, tool permission policy, tool selection policy, or TaskLoop decision input
  - automatic AgentMap discovery from TaskLoop or runtime shadow paths
  - candidate text being stored in reports or persisted to disk
  - replacing, wrapping, disabling, deprecating, or discouraging default read, grep, find, or ls behavior
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment remains default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow remains default off by omission and only enables diagnostics when promptAssemblyExperiment is also true.
  - runtime.agentMap.provider remains separate from prompt candidate runtime shadowing and must remain default-off.
rollback:
  - Remove the replay proof tests and handoff if validation fails.
  - Disable or remove runtime.agentMap.promptCandidateRuntimeShadow and the pure runtime shadow adapter if a later rollback removes the pilot.
  - Preserve AgentMap readonly provider readiness, direct discovery tools, legacy context, loop context pack, TaskLoop, Gateway, provider transport, prompt assembly, and renderer/Main boundaries as authoritative.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt" <agentmap-replay-proof-touched-files>
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\(|unlink|createWriteStream|fs\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-replay-proof-touched-files>
  - pnpm --config.verify-deps-before-run=false run comms:replay and pnpm --config.verify-deps-before-run=false run comms:compare only if Main/Gateway/host-api/api-client/provider transport paths are touched
acceptance:
  - The task spec validates.
  - Previous runtime shadow pilot synthesis remains accepted.
  - Replay proof is explicit double opt-in and default-off.
  - Repeated pure adapter runs with identical explicit input produce stable status, contentHash, tokenEstimate, contentLength, includedSymbolCount, includedFileCount, promptPresentExcludedCount, diagnostic codes, and authority flags.
  - Budget variant tests prove candidate measurement changes only report diagnostics and metadata, never prompt/model/provider behavior.
  - Prompt-present exclusion replay proves excluded files remain diagnostics-only and never enter candidate authority.
  - Disabled-state tests prove no TaskLoop report without both flags and explicit valid AgentMapResult.
  - TaskLoop replay proof shows reviewer context and prompt text are unchanged and candidate text is absent.
  - Default runtime behavior, default prompt assembly text/order, and default provider ordering are unchanged.
  - Candidate text is never fed to TaskLoop prompts, reviewer prompts, Gateway, model messages, provider transport, user prompt, chat prompts, or system prompt.
  - Shadow diagnostics prove no prompt authority, no tool authority, no runtime authority, no prompt cutover, no tool cutover, no Gateway cutover, no provider transport cutover, and no model-message cutover.
  - No direct discovery tool replacement, mutation/apply/edit surface, service/listener/daemon/database, disk persistence, renderer IPC bypass, or renderer direct Gateway call is added.
  - Focused tests, existing AgentMap/config/TaskLoop tests, typecheck, and boundary scans pass or are documented as unrelated existing false positives.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Candidate Runtime Shadow Replay Proof

This task is a narrow proof follow-up to the accepted AgentMap prompt candidate runtime shadow pilot. It may add focused replay/stability tests and handoff evidence, but it does not approve prompt cutover.

AgentMap remains default-off, readonly, explicit-input only, opt-in/shadow-only, diagnostics-only, and non-authoritative. Candidate text may be measured by the pure helper, but must not be stored in reports, persisted to disk, or inserted into TaskLoop prompts, reviewer prompts, Gateway requests, model messages, provider transport, user prompts, chat prompts, or system prompts.
