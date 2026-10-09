---
id: phase-line-b-agentmap-runtime-use-readiness
title: Line B AgentMap runtime-use readiness without cutover
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prepare AgentMap for later explicit runtime use through hardening, real repository fixtures, performance budgets, caching, error isolation, and shadow diagnostics while preserving default-off, readonly, non-authoritative behavior until a fresh accepted cutover spec exists.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
  - runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/**
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/**
  - runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/agent-map.ts
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - tests/unit/runtime-agent-map-*.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/fixtures/agent-map/**
expectedUserBehavior:
  - AgentMap may be hardened for runtime-use readiness through deterministic readonly behavior, real repository fixtures, performance budgets, cache invalidation, provider failure isolation, and shadow diagnostics.
  - AgentMap may be exposed only through an explicit default-off provider, opt-in provider injection, or diagnostic shadow path. The default provider registry ordering and default prompt behavior remain unchanged.
  - AgentMap readiness work must keep legacy context, direct discovery tools, TaskLoop, Gateway, provider transport, and prompt assembly authoritative by default.
  - AgentMap readiness evidence must prove flag-off/default-off behavior, bounded rendering, stable fixtures, isolated failures, cache correctness if caching exists, and no runtime authority.
  - No implementation in this phase may claim runtime cutover readiness beyond default-off opt-in/shadow diagnostics. A fresh cutover spec and synthesis are required before any default-on or authoritative use.
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
  - default-on AgentMap provider behavior, default provider registration, provider ordering cutover, or automatic provider enablement
  - TaskLoop cutover, Gateway cutover, provider transport cutover, model-message cutover, chat prompt cutover, or default prompt assembly cutover
  - AgentMap output becoming authoritative runtime context, completion evidence, retry policy, security policy, approval policy, tool permission policy, or tool selection policy
  - replacing, wrapping, disabling, deprecating, or discouraging default read, grep, find, or ls behavior
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol/workspace operation
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - cache behavior that hides file content, mtime, hash, config, request, or budget changes without explicit invalidation evidence
  - swallowing AgentMap provider failures without structured diagnostics and evidence refs
  - claims about AgentMap quality, coverage, performance, cache safety, or runtime-use readiness without path, fixture, test, command, and evidence-ref support
featureFlags:
  - Any new AgentMap runtime-use readiness flag must default off.
  - Any provider option must be explicit opt-in and must authorize only readonly diagnostics or shadow output.
  - No flag in this phase may enable default prompt assembly, TaskLoop, Gateway, provider ordering, read/grep/find/ls replacement, or mutating behavior.
rollback:
  - Remove or disable the explicit AgentMap opt-in/shadow provider path.
  - Disable AgentMap caching or diagnostics while preserving existing legacy context behavior.
  - Keep direct read/grep/find/ls tools, legacy context, loop context pack, TaskLoop, Gateway, provider transport, prompt assembly, and renderer/Main boundaries authoritative.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
  - pnpm harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
  - pnpm exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts
  - pnpm run typecheck if runtime source, provider source, config, shared contracts, or exported runtime-core surfaces are changed
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components if renderer files are touched
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(' <agentmap-runtime-use-touched-files> if runtime, Electron, shared, tests, or fixtures are touched
  - node scripts/scan-pattern.mjs --pattern 'rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply' <agentmap-runtime-use-touched-files> if AgentMap, Symbol Tool, AST, edit-adjacent, or provider files are touched
  - pnpm run comms:replay and pnpm run comms:compare only if Main/Gateway/host-api/api-client/provider transport paths are touched
acceptance:
  - The task spec validates and the next-phase handoff documents the allowed hardening and opt-in/shadow boundaries.
  - AgentMap hardening evidence uses real repository fixtures or fixture snapshots that are deterministic, reviewable, and tied to source paths.
  - Performance budget evidence records command, fixture size, budget, timing or operation-count proxy, and acceptable threshold without adding a service, daemon, listener, or external database.
  - Cache evidence, if caching is implemented, proves cache keys and invalidation for file content, mtime or hash, request inputs, config, and token budget changes.
  - Error isolation evidence proves malformed inputs, extraction failures, cache failures, and provider failures return structured diagnostics without changing legacy/default output.
  - Provider evidence proves explicit opt-in/default-off behavior, shadow diagnostics, no prompt authority, no tool authority, no runtime authority, and unchanged default `createContextProviderRegistryPilot()` ordering.
  - Boundary scans prove no TaskLoop/Gateway/provider-ordering/default-prompt cutover, no read/grep/find/ls replacement, no mutation/apply/edit behavior, no new service/listener/daemon/external database, and no renderer/Main transport bypass.
  - Every next-phase lane submission contains exactly one status line using Status: accepted, Status: needs_revision, or Status: blocked, backed by path/function/test/command evidence.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Line B AgentMap Runtime-Use Readiness

This spec prepares AgentMap for a later runtime-use decision without authorizing runtime cutover. The phase may harden readonly AgentMap behavior, expand real repository fixtures, measure performance budgets, add explicit cache/error-isolation evidence, and improve default-off shadow diagnostics.

Default-on behavior, TaskLoop/Gateway/provider-ordering cutover, default prompt assembly cutover, read/grep/find/ls replacement, mutation/apply/edit capabilities, and new services/listeners/daemons/databases remain out of scope.
