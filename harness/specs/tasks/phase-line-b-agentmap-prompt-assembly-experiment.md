---
id: phase-line-b-agentmap-prompt-assembly-experiment
title: Line B AgentMap prompt assembly experiment without cutover
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an explicit default-off AgentMap prompt assembly experiment that converts readonly AgentMap diagnostic output into a bounded prompt candidate/addendum for evaluation only, without changing default prompt assembly, TaskLoop, Gateway, provider transport, provider ordering, or runtime behavior.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
  - runtime-research/handoffs/line-b-agentmap-prompt-assembly-experiment/**
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-prompt-assembly-experiment/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - AgentMap prompt assembly experimentation remains explicit opt-in and default-off.
  - Default prompt text, model messages, TaskLoop prompts, Gateway requests, provider transport, and context provider registry ordering remain unchanged.
  - The experiment may produce deterministic candidate text and structured metadata from explicit AgentMapResult input only; that candidate is evaluation data, not authoritative prompt context.
  - The candidate must be bounded by a caller-provided token budget, exclude prompt-present files, preserve complete symbol blocks, expose diagnostic metadata, and carry no prompt/tool/runtime authority.
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
  - TaskLoop prompt cutover, Gateway cutover, provider transport cutover, model-message cutover, chat prompt cutover, or default prompt assembly cutover
  - AgentMap output becoming authoritative runtime context, prompt context, completion evidence, retry policy, security policy, approval policy, tool permission policy, or tool selection policy
  - replacing, wrapping, disabling, deprecating, or discouraging default read, grep, find, or ls behavior
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - unknown prompt-cutover-like runtime.agentMap keys being accepted by config schema
featureFlags:
  - Any AgentMap prompt assembly experiment flag must default off by omission.
  - runtime.agentMap.promptAssemblyExperiment may only enable a pure candidate-producing helper or focused tests; it must not register AgentMap, change provider ordering, or feed any default prompt/model/runtime path.
  - runtime.agentMap.provider remains separate from prompt assembly experimentation and must remain default-off.
rollback:
  - Disable or remove the prompt assembly experiment flag/helper/tests.
  - Preserve AgentMap readonly provider readiness, direct discovery tools, legacy context, loop context pack, TaskLoop, Gateway, provider transport, prompt assembly, and renderer/Main boundaries as authoritative.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-hardening.test.ts tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-quality.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-feature-config-schema.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - node scripts/scan-pattern.mjs --pattern "agent-map-readonly-shadow|createAgentMapContextProvider|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
  - node scripts/scan-pattern.mjs --pattern "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-prompt-experiment-touched-files>
  - node scripts/scan-pattern.mjs --pattern "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-prompt-experiment-touched-files>
  - pnpm --config.verify-deps-before-run=false run comms:replay and pnpm --config.verify-deps-before-run=false run comms:compare only if Main/Gateway/host-api/api-client/provider transport paths are touched
acceptance:
  - The task spec validates.
  - The experiment is explicit opt-in and default-off by omission.
  - The helper is pure, deterministic, readonly, and takes explicit AgentMapResult input.
  - Candidate text is bounded by caller token budget, uses deterministic ordering, excludes prompt-present files, and preserves complete symbol blocks.
  - Candidate metadata includes experimental, readonlyAgentMap, defaultOff, noPromptCutover, noPromptAuthority, noToolAuthority, and noRuntimeAuthority.
  - Default runtime behavior, default prompt assembly text/order, default context provider registration, TaskLoop, Gateway, provider transport, and model messages are unchanged.
  - No direct discovery tool replacement, mutation/apply/edit surface, service/listener/daemon/database, renderer IPC bypass, or renderer direct Gateway call is added.
  - Focused tests, existing AgentMap tests, config schema tests, typecheck, and boundary scans pass or are documented as unrelated existing false positives.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Prompt Assembly Experiment

This task creates a narrow experiment that converts explicit readonly AgentMap diagnostic output into a bounded prompt candidate/addendum for evaluation. It does not approve prompt cutover.

AgentMap remains default-off, readonly, opt-in/shadow-only, and non-authoritative. Default-on behavior, default prompt assembly changes, TaskLoop/Gateway/model-message cutover, provider ordering changes, direct discovery tool replacement, mutation/edit surfaces, and new services remain out of scope.
