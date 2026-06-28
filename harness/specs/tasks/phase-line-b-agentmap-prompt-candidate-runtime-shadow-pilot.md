---
id: phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot
title: Line B AgentMap prompt candidate runtime shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an explicit default-off runtime shadow diagnostic pilot for AgentMap prompt candidates, observing candidate shape, budget, stability, and authority boundaries without adding AgentMap candidate text to TaskLoop prompts, Gateway requests, model messages, provider transport, or default prompt assembly.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/**
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - AgentMap prompt candidate runtime shadow diagnostics remain explicit opt-in and default-off.
  - Enabling the pilot requires both runtime.agentMap.promptAssemblyExperiment and runtime.agentMap.promptCandidateRuntimeShadow to be true.
  - Default prompt text, TaskLoop reviewer prompts, Gateway requests, model messages, provider transport, context provider ordering, and runtime decisions remain unchanged.
  - Runtime shadow output records diagnostics and evidence only: candidate metadata, token budget, token estimate, included symbol/file counts, prompt-present exclusion counts, and non-authority flags.
  - Candidate text may be generated for measurement by the pure helper but must not be inserted into authoritative runtime context or model-facing payloads.
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
  - TaskLoop prompt cutover, reviewer prompt cutover, Gateway cutover, provider transport cutover, model-message cutover, chat prompt cutover, system-prompt cutover, or default prompt assembly cutover
  - AgentMap output becoming authoritative runtime context, prompt context, completion evidence, retry policy, security policy, approval policy, tool permission policy, tool selection policy, or TaskLoop decision input
  - replacing, wrapping, disabling, deprecating, or discouraging default read, grep, find, or ls behavior
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - unknown prompt-cutover-like runtime.agentMap keys being accepted by config schema
featureFlags:
  - runtime.agentMap.promptAssemblyExperiment must remain default off by omission.
  - runtime.agentMap.promptCandidateRuntimeShadow must default off by omission and only enables diagnostics when promptAssemblyExperiment is also true.
  - runtime.agentMap.provider remains separate from prompt candidate runtime shadowing and must remain default-off.
rollback:
  - Disable or remove runtime.agentMap.promptCandidateRuntimeShadow, the pure runtime shadow adapter, and any explicit TaskLoop diagnostic injection.
  - Preserve AgentMap readonly provider readiness, direct discovery tools, legacy context, loop context pack, TaskLoop, Gateway, provider transport, prompt assembly, and renderer/Main boundaries as authoritative.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
  - rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-runtime-shadow-touched-files>
  - rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-runtime-shadow-touched-files>
  - rg -n "model messages|provider transport|Gateway request|system prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt" <agentmap-runtime-shadow-touched-files>
  - pnpm --config.verify-deps-before-run=false run comms:replay and pnpm --config.verify-deps-before-run=false run comms:compare only if Main/Gateway/host-api/api-client/provider transport paths are touched
acceptance:
  - The task spec validates.
  - Runtime shadow pilot is explicit opt-in and default-off by omission.
  - TaskLoop/runtime diagnostics require double opt-in and explicit AgentMapResult input.
  - Default runtime behavior, default prompt assembly text/order, default context provider registration, TaskLoop decisions, Gateway, provider transport, and model messages are unchanged.
  - Candidate text is never fed to TaskLoop prompts, Gateway, model messages, provider transport, chat prompts, reviewer prompts, or system prompt.
  - Shadow diagnostics prove no prompt authority, no tool authority, no runtime authority, no prompt cutover, no tool cutover, no Gateway cutover, and no provider transport cutover.
  - AgentMap remains readonly, diagnostic, non-authoritative, and default-off.
  - No direct discovery tool replacement, mutation/apply/edit surface, service/listener/daemon/database, renderer IPC bypass, or renderer direct Gateway call is added.
  - Focused tests, existing AgentMap/config/TaskLoop tests, typecheck, and boundary scans pass or are documented as unrelated existing false positives.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/README.md
    - runtime-research/handoffs/line-b-agentmap-prompt-candidate-runtime-shadow-pilot/synthesis.md
---

# Line B AgentMap Prompt Candidate Runtime Shadow Pilot

This task creates the next AgentMap slice after the accepted prompt assembly experiment. It may observe prompt candidate shape, budget, and stability inside runtime diagnostics, but it does not approve prompt cutover.

AgentMap remains default-off, readonly, opt-in/shadow-only, and non-authoritative. Candidate text must not enter TaskLoop prompts, reviewer prompts, Gateway requests, model messages, provider transport, chat prompts, or system prompts.
