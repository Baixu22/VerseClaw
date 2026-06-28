# Line B Development Phases

This document persists the implementation-phase layout for Line B: AgentMap plus Symbol Tool Layer readonly/shadow foundation. It is the phase control document for future development windows. Prompt text is intentionally deferred; use the prompt handoff order near the end when requesting the next set of prompts.

## Global Development Boundary

This line remains readonly/shadow only until a later synthesis and cutover spec explicitly accepts more.

Allowed globally:

- pure runtime contracts, type guards, fixtures, ranking, renderers, diagnostics, and evidence metadata;
- readonly symbol lookup, references, diagnostics, and drift detection;
- explicit test-only provider injection;
- default-off shadow provider factories after readonly result shapes are proven;
- harness/task-spec and handoff documentation.

Forbidden globally:

- default runtime behavior changes;
- TaskLoop, Gateway, provider ordering, chat prompt, or model-message cutover;
- AST patch apply, symbol edit apply, rename, safe delete, workspace edit, or mutating symbol tools;
- new service, listener, daemon, external database, always-on LSP service, second Gateway, or second runtime;
- renderer direct `window.electron.ipcRenderer.invoke(...)` calls or direct Gateway HTTP/WS calls;
- bypassing `src/lib/host-api.ts`, `src/lib/api-client.ts`, or Main-owned proxy policy;
- unverified code-understanding claims without path, test, fixture, or command evidence.

## Phase 0: Spec And Boundary Setup

Goal: create the task-spec and validation boundary before implementation.

Allowed changes:

- add a Line B harness task spec under `harness/specs/tasks/`;
- update this handoff directory with submission templates if needed;
- add docs-only clarifications for readonly/shadow scope.

Forbidden changes:

- no runtime source changes;
- no config flags unless the spec requires only documentation of future flags;
- no provider registration or tool behavior changes.

Suggested files:

- `harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/development-phases.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/parallel-lanes.md`

Deliverables:

- task spec with explicit readonly/shadow acceptance criteria;
- validation read list selected by `pnpm harness context --spec ...`;
- documented blocked boundaries for TaskLoop/Gateway/provider ordering/patch apply.

Validation:

- `pnpm harness context --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`
- `pnpm harness validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`

Exit criteria:

- spec validates;
- implementation lanes can reference one canonical spec;
- no runtime files touched.

## Phase 1: AgentMap Readonly Contracts

Goal: define AgentMap's stable data model before ranking and provider work.

Allowed changes:

- add AgentMap request/result/tag/ranking/evidence contracts;
- add type guards and fixture builders;
- export contracts only if tests prove the shape;
- add unit tests for valid and invalid contract shapes.

Forbidden changes:

- no AgentMap provider registration;
- no prompt assembly integration;
- no direct read/grep/find/ls wrapping;
- no TaskLoop/Gateway/chat integration.

Suggested files:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-agent-map-contracts.test.ts`

Deliverables:

- `AgentMapRequest`
- `AgentMapTag`
- `AgentMapRankedSymbol`
- `AgentMapRankedFile`
- `AgentMapRenderResult`
- scoring reason taxonomy
- evidence metadata contract

Validation:

- focused AgentMap contract tests;
- runtime-core barrel export tests if `index.ts` changes;
- typecheck if public exports change.

Exit criteria:

- contracts are deterministic and JSON-safe where needed;
- every result can carry source file/range/symbol evidence;
- no behavior-changing import appears in TaskLoop, Gateway, renderer, or provider registry.

## Phase 2: AgentMap Ranking And Budget Render

Goal: implement Aider-inspired readonly ranking and budgeted render over TypeScript/TSX fixtures.

Allowed changes:

- implement TS/TSX readonly tag extraction;
- rank by active files, mentioned files, mentioned identifiers, path components, and reference-to-definition links;
- render file-grouped symbol blocks with stable line/range metadata;
- fit budget by reducing selected symbol count and re-rendering;
- add deterministic fixture snapshots.

Forbidden changes:

- no default use of AgentMap in runtime prompts;
- no replacement of read/grep/find/ls;
- no provider ordering changes;
- no hidden fallback without diagnostics.

Suggested files:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `tests/unit/runtime-agent-map-ranking.test.ts`
- `tests/unit/runtime-agent-map-renderer.test.ts`
- `tests/unit/runtime-agent-map-budget.test.ts`
- `tests/fixtures/agent-map/tsx-electron-workspace/**`

Deliverables:

- tag extraction for TS/TSX fixtures;
- explainable ranking reasons;
- budgeted render output;
- prompt-present file exclusion or explicit already-present marking;
- snapshot fixtures.

Validation:

- active-file reference ranking test;
- mentioned identifier ranking test;
- budget monotonic shrink test;
- no partial symbol-block truncation test;
- snapshot stability test.

Exit criteria:

- ranking is deterministic;
- selected symbols include evidence refs and scoring reasons;
- smaller budgets reduce output monotonically;
- no runtime behavior changes.

## Phase 3: Symbol Tool Readonly Foundation

Goal: implement Serena-inspired readonly symbol capabilities for overview/find/references/diagnostics.

Allowed changes:

- add readonly symbol contracts and type guards;
- add explicit adapter around existing LSP request support if needed;
- implement or prove overview, find, references, and diagnostics for TS/TSX fixtures;
- return structured fallback when LSP is unavailable;
- add checkpoint relocation or drift detection.

Forbidden changes:

- no rename;
- no replace body, insert before/after, safe delete, workspace edit, or patch apply;
- no always-on LSP service;
- no provider registration by default;
- no durable checkpoint claim based on LSP process state.

Suggested files:

- `openclaw_runtime/src/runtime-core/symbols.ts`
- `openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts`
- `openclaw_runtime/src/agents/embedded-agent-lsp.ts`
- `tests/unit/runtime-symbol-tool-contracts.test.ts`
- `tests/unit/runtime-symbol-tool-readonly.test.ts`
- `tests/fixtures/symbol-tool/tsx-renderer-main-shared/**`

Deliverables:

- `SymbolQuery`
- `SymbolResult`
- `SymbolReference`
- `SymbolDiagnostic`
- `SymbolCheckpoint`
- structured fallback/error taxonomy
- namePath/range disambiguation rules

Validation:

- document symbols test for top-level and nested symbols;
- same-name/nested disambiguation test;
- cross-file references test;
- diagnostics wrapper test;
- LSP unavailable structured fallback test;
- checkpoint relocation/drift test.

Exit criteria:

- readonly symbol operations work on fixtures;
- all fallbacks are structured;
- no mutating symbol APIs exist in this phase.

## Phase 4: Context Provider Shadow

Goal: expose AgentMap and/or Symbol readonly results as explicit shadow context providers without changing legacy behavior.

Allowed changes:

- add explicit `createAgentMapContextProvider` and/or `createSymbolContextProvider` factories;
- use existing `RuntimeContextProvider` and `RuntimeContextProviderResult` contracts;
- allow explicit extra-provider injection in tests;
- emit diagnostics and evidence refs;
- add flag-off/default-order parity tests.

Forbidden changes:

- no default provider registration;
- no `createContextProviderRegistryPilot()` default ordering change unless a later accepted spec says so;
- no TaskLoop/Gateway/chat/model prompt consumption;
- no renderer/Main API route unless a fresh spec accepts it;
- no provider output authority.

Suggested files:

- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
- `openclaw_runtime/src/context-engine/symbol-context-provider.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `tests/unit/runtime-agent-map-context-provider.test.ts`
- `tests/unit/runtime-symbol-context-provider.test.ts`
- `tests/unit/context-provider-registry.test.ts`

Deliverables:

- explicit provider factories;
- provider manifests with `shadowOnly: true`;
- readonly context items with evidence refs;
- diagnostics proving legacy authoritative behavior;
- tests proving default provider ordering is unchanged.

Validation:

- flag-off no-output test;
- flag-on shadow diagnostics-only test;
- provider failure isolation test;
- default ordering unchanged test;
- renderer IPC/Gateway bypass scan if renderer/Main files are touched;
- service/listener/daemon scan over touched files.

Exit criteria:

- provider output exists only through explicit shadow path;
- no live runtime consumer is changed;
- rollback is removing explicit provider injection or disabling flags.

## Phase 5: Validation And Synthesis

Goal: validate all phase evidence and decide whether the readonly/shadow foundation is accepted.

Allowed changes:

- write lane submissions and synthesis;
- update `runtime-research/agent-runtime-index.md` only after implementation evidence lands;
- update docs/harness references when accepted by synthesis.

Forbidden changes:

- no new runtime implementation;
- no accepting cutover claims;
- no marking AgentMap/Symbol as default or authoritative.

Suggested files:

- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/**`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/synthesis.md`
- `runtime-research/agent-runtime-index.md`

Deliverables:

- A-D lane status classifications;
- focused test and scan evidence;
- synthesis with accepted/needs_revision/blocked classification;
- index update only if code/tests actually landed.

Validation:

- future Line B harness validate;
- focused AgentMap tests;
- focused Symbol Tool tests;
- focused context provider tests;
- typecheck if source changed;
- boundary scans;
- comms replay/compare only if Main/Gateway/host-api/api-client/provider transport paths changed.

Exit criteria:

- every lane has exactly one status line;
- synthesis re-verifies claims;
- default runtime behavior remains unchanged.

## Phase Dependencies

```text
Phase 0 spec
  -> Phase 1 AgentMap contracts
  -> Phase 2 AgentMap ranking/render
  -> Phase 4 provider shadow
  -> Phase 5 validation/synthesis

Phase 0 spec
  -> Phase 3 Symbol readonly
  -> Phase 4 provider shadow
  -> Phase 5 validation/synthesis
```

Phase 1 and Phase 3 may run in parallel after Phase 0. Phase 2 depends on Phase 1. Phase 4 depends on at least one stable readonly result shape from Phase 2 or Phase 3.

## Prompt Handoff Order

When prompts are requested later, generate them in this order:

1. Phase 0 spec and boundary prompt.
2. Phase 1 AgentMap contracts prompt.
3. Phase 3 Symbol readonly prompt.
4. Phase 2 AgentMap ranking/render prompt.
5. Phase 4 context provider shadow prompt.
6. Phase 5 validation/synthesis prompt.

Each prompt must restate the global forbidden boundary and name the exact output document or submission file for that phase.

## Status

Status: accepted
