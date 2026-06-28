# Line B AgentMap And Symbol Tool Readonly/Shadow Synthesis

This synthesis audits Line B Phase 1-4 implementation evidence. Per the follow-up instruction for this validation run, the missing Phase 0 submission is not treated as a blocker; the Phase 0 task spec and planning docs were still read and validated.

## Scope Decision

Line B is accepted only as a readonly/shadow foundation. This synthesis does not accept runtime cutover, provider ordering cutover, TaskLoop or Gateway integration, model prompt authority, default provider registration, Symbol mutation, AST patch apply, or any patch application path.

## Submission Audit

| Submission | Phase | Status-line count | Reclassified |
|---|---:|---:|---|
| `submissions/line-b-a-agentmap-contracts-ranking.md` | 1 | 1 | accepted |
| `submissions/line-b-c-agentmap-render-budget-fixtures.md` | 2 | 1 | accepted |
| `submissions/line-b-b-symbol-readonly-contracts.md` | 3 | 1 | accepted |
| `submissions/line-b-d-context-provider-shadow-boundary.md` | 4 | 1 | accepted |

Phase 0 submission audit was waived for this run by user instruction. The canonical task spec and planning docs validate and preserve the readonly/shadow boundary.

## Evidence Review

AgentMap contracts and implementation are landed in `openclaw_runtime/src/runtime-core/agent-map.ts`: contracts start at `AgentMapRequest` and `AgentMapResult`, extraction at `extractAgentMapTagsFromSources`, ranking at `rankAgentMapTags`, rendering at `renderAgentMapRankedTags`, and budget fitting at `buildBudgetedAgentMapResult`. Tests cover contract rejection, prompt-present exclusion, TS/TSX tag extraction, active-file reference lift, mentioned identifier lift, deterministic rendering, budget monotonic shrinkage, and no partial symbol-block truncation.

Symbol readonly contracts are landed in `openclaw_runtime/src/runtime-core/symbols.ts`: readonly operation vocabulary, structured fallback, overview normalization, `findRuntimeSymbols`, `groupRuntimeSymbolReferences`, and checkpoint relocation/drift reporting. Tests cover readonly operation closure, stable nested symbol nodes, name/namePath disambiguation, grouped cross-file references with snippets, LSP-unavailable fallback, and checkpoint relocation/drift.

Context provider shadow integration is landed in `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`, `openclaw_runtime/src/context-engine/symbol-context-provider.ts`, and `openclaw_runtime/src/context-engine/provider-registry.ts`. The factories are explicit, `enabledByDefault: false`, `shadowOnly: true`, and emit legacy-authoritative diagnostics. `createContextProviderRegistryPilot()` still defaults to `legacy-context-engine` then `loop-context-pack`; AgentMap/Symbol providers run only through explicit extra-provider injection.

## Validation

Passed:

- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts`
- Focused Vitest result: 9 files, 32 tests passed.
- `pnpm --config.verify-deps-before-run=false run typecheck`
- Renderer IPC/Gateway bypass scan over `src/pages src/components`: no matches.
- Service/listener/daemon/database scan over Line B source/tests/fixtures: no matches.
- Symbol/AST mutation scan over Line B source/tests/fixtures: no matches.
- TaskLoop/Gateway/Electron/renderer/shared cutover search for new Line B surfaces: no Line B integration found. The only hit was an unrelated `byAgentMap` local variable in `openclaw_runtime/src/gateway/server-methods/usage.ts`.
- `pnpm --config.verify-deps-before-run=false run comms:replay`
- `pnpm --config.verify-deps-before-run=false run comms:compare`

Tooling note: `rtk` is not available on PATH in this workspace, so direct `pnpm`, local binaries, and `rg` were used.

## Classification

| Phase | Reclassification | Reason |
|---|---|---|
| Phase 0 | accepted | Submission audit waived; task spec and planning docs validate and enforce docs/spec-only readonly/shadow scope. |
| Phase 1 | accepted | AgentMap contracts are deterministic, JSON-safe, readonly, budget-bounded, and tested without provider registration or prompt authority. |
| Phase 2 | accepted | AgentMap TS/TSX extraction, explainable ranking, fixture rendering, and budget fitting are tested and remain diagnostic-only. |
| Phase 3 | accepted | Symbol overview/find/references/diagnostics/checkpoint contracts and helpers are readonly, structured, tested, and mutation-free. |
| Phase 4 | accepted | AgentMap/Symbol context providers are explicit shadow-only factories; default provider ordering and legacy authority are preserved. |

## Next Boundary

A later cutover must use a fresh accepted cutover spec. Until then, AgentMap and Symbol Tool outputs may be used only as readonly contracts, deterministic test evidence, diagnostics, and explicit shadow provider injection.

Status: accepted
