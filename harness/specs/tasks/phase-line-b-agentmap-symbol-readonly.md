---
id: phase-line-b-agentmap-symbol-readonly
title: Line B AgentMap and Symbol Tool readonly/shadow boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Establish the Line B harness boundary for AgentMap plus Symbol Tool work so Phase 0 may add only task-spec and handoff documentation, while later implementation remains readonly/shadow, default-off, and non-authoritative until a fresh accepted cutover spec exists.
ownedPaths:
  - harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md
  - runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/**
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/**
  - runtime-research/agent-runtime-index.md
  - runtime-research/implementation-roadmap.md
  - runtime-research/migration-execution-plan.md
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - tests/unit/**
  - tests/fixtures/**
expectedUserBehavior:
  - Phase 0 creates or updates only the Line B harness task spec and handoff documentation. It must not modify runtime source, tests, config, provider registration, TaskLoop, Gateway, renderer, Electron Main, or package behavior.
  - Later AgentMap work may add deterministic readonly contracts, TS/TSX tag extraction, explainable ranking, budgeted rendering, fixtures, diagnostics, and evidence metadata, but it must not feed default prompt assembly or replace read/grep/find/ls behavior.
  - Later Symbol Tool work may add readonly overview/find/references/diagnostics/checkpoint contracts and TS/TSX fixture-backed behavior, but it must not add rename, workspace edit, safe delete, symbol edit apply, AST patch apply, or mutating tools.
  - Later context-provider work may expose AgentMap or Symbol results only through explicit shadow/default-off provider factories or test injection, preserving legacy context output and default provider ordering.
  - No Line B phase may cut over TaskLoop, Gateway, provider ordering, model prompt assembly, provider transport, approval policy, retry policy, completion gates, or runtime authority without a later accepted cutover spec and synthesis.
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
  - runtime source changes during Phase 0 spec and boundary setup
  - TaskLoop cutover, Gateway cutover, provider ordering cutover, chat prompt cutover, model-message cutover, default provider registration, or runtime execution cutover
  - AgentMap or Symbol output becoming authoritative context, completion evidence, retry policy, security policy, tool permission policy, or runtime authority
  - AST patch apply, symbol edit apply, rename, replace body, insert before/after, safe delete, workspace edit, or any mutating symbol tool
  - changing direct read, grep, find, ls, existing LSP tool behavior, approval behavior, tools.invoke return payloads, or fallback transport behavior
  - new service, listener, daemon, external database, graph database service, HTTP server, WebSocket server, always-on LSP service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - fallback from symbol lookup to grep/read without structured reason metadata
  - claims about code understanding, ranking quality, symbol coverage, drift handling, or parity without path, fixture, test, command, and evidence-ref support
featureFlags:
  - Line B Phase 0 defines no runtime feature flags and must not edit config schemas.
  - Future AgentMap shadow flags, if added by a later accepted phase, must default off and authorize only readonly diagnostics or explicit test/shadow output.
  - Future Symbol Tool flags, if added by a later accepted phase, must default off and authorize only readonly overview/find/references/diagnostics/checkpoint behavior.
  - Future context-provider flags, if added by a later accepted phase, must default off and preserve legacy provider ordering and output authority.
rollback:
  - Revert or remove the Line B task spec and handoff documentation updates.
  - Disable or omit any future explicit AgentMap/Symbol shadow provider injection.
  - Keep existing TaskLoop, Gateway, tools.invoke, read/grep/find/ls, bundled LSP behavior, context provider ordering, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, Runtime Memory Provider, and renderer/Main transport boundaries authoritative.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md
  - pnpm harness validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md
  - pnpm harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md if future Line B work touches provider registry behavior
  - pnpm run comms:replay and pnpm run comms:compare only if a later accepted phase touches Main/Gateway/host-api/api-client/provider transport paths
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components if renderer files are touched
  - rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(' <line-b-touched-files> if runtime, Electron, shared, or tests are touched
  - rg -n 'rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply' <line-b-touched-files> if AgentMap, Symbol Tool, AST, or edit-adjacent files are touched
acceptance:
  - Phase 0 adds a canonical harness task spec for Line B and validates it with harness context and harness validate.
  - Phase 0 changes are docs/spec-only and do not touch runtime source, runtime tests, config schemas, TaskLoop, Gateway, provider registry code, renderer, Electron Main, shared host contracts, or package behavior.
  - The spec explicitly permits only readonly/shadow planning, contracts, diagnostics, deterministic fixtures, evidence metadata, and validation criteria before a later implementation phase.
  - AgentMap acceptance requires deterministic TS/TSX symbol/tag fixtures, explainable ranking reasons, active-file and mentioned-identifier lift, prompt-present file exclusion or marking, budget monotonic shrinkage, and no partial symbol-block truncation.
  - Symbol Tool acceptance requires readonly overview/find/references/diagnostics results, namePath/range disambiguation, cross-file references grouped by file with snippets, structured LSP-unavailable fallback, and checkpoint relocation or explicit drift reporting.
  - Context-provider shadow acceptance requires explicit provider factory/injection only, diagnostics/evidence-only output, provider failure isolation, default provider ordering unchanged, and legacy context remaining authoritative.
  - Boundary evidence must prove no TaskLoop/Gateway/provider-ordering/model-prompt cutover, no mutating symbol or AST patch apply behavior, no new service/listener/daemon/external database, and no renderer/Main transport bypass.
  - Every future Line B lane submission must contain exactly one status line using Status: accepted, Status: needs_revision, or Status: blocked, backed by path/function/test/command evidence.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md
    - runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/development-phases.md
    - runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/parallel-lanes.md
    - runtime-research/agent-runtime-index.md
    - runtime-research/implementation-roadmap.md
    - runtime-research/migration-execution-plan.md
---

# Line B AgentMap And Symbol Tool Readonly/Shadow Boundary

Phase 0 establishes the canonical task-spec boundary for Line B. It is intentionally docs/spec-only: AgentMap, Symbol Tool, and context-provider implementation work must start from this boundary but must not begin in Phase 0.

Line B remains readonly/shadow until a later synthesis accepts fixture-backed evidence and a fresh cutover spec explicitly authorizes runtime behavior changes.
