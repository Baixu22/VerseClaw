# Line B Parallel Lanes

All lanes are readonly/shadow only. Each implementation lane must preserve legacy behavior by default and write its own submission under `submissions/` if implementation begins later. This planning handoff does not create submissions and does not implement code.

## Shared Acceptance Rules

An accepted future lane must include:

- exact files read and changed;
- path/function/test/command evidence for each claim;
- proof that default runtime behavior is unchanged;
- proof that TaskLoop, Gateway, provider ordering, and model prompt assembly are not cut over;
- proof that no AST patch apply, symbol edit apply, rename, safe delete, or workspace edit was introduced;
- proof that no service, listener, daemon, external database, or always-on LSP service was introduced;
- focused unit tests and fixture evidence;
- boundary scans if renderer/Main/Gateway/host-api/api-client paths are touched;
- comms replay/compare only if communication paths changed.

Use `needs_revision` for missing evidence, default behavior changes, provider ordering changes, prompt consumption, unstructured fallback, unverified code understanding claims, or any mutation/edit/apply behavior.

## Lane A: AgentMap Contracts And Ranking

LANE_ID: `line-b-a-agentmap-contracts-ranking`

LANE_TITLE: AgentMap readonly contracts, tags, and explainable ranking

LANE_SCOPE:

- Define AgentMap request/result/tag/ranking/scoring contracts.
- Implement or prove TypeScript/TSX readonly tag extraction.
- Build active file, mentioned file, mentioned identifier, path component, and reference-to-definition ranking.
- Preserve per-symbol scoring reasons and evidence refs.
- Do not register a context provider or alter runtime behavior.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-agent-map-contracts.test.ts`
- `tests/unit/runtime-agent-map-ranking.test.ts`
- `tests/fixtures/agent-map/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-a-agentmap-contracts-ranking.md
```

## Lane B: Symbol Tool Readonly Contracts

LANE_ID: `line-b-b-symbol-readonly-contracts`

LANE_TITLE: Symbol Tool readonly overview/find/references/diagnostics contracts

LANE_SCOPE:

- Define readonly symbol contracts: query, result, reference, diagnostic, checkpoint, structured fallback.
- Add TypeScript/TSX overview/find/references/diagnostics support through an explicit lower-level client or mockable adapter.
- Reuse existing bundled LSP runtime only if it stays session-scoped, disposable, and non-default.
- Do not add edit tools, rename, safe delete, workspace edit, or patch apply.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/symbols.ts`
- `openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts`
- `openclaw_runtime/src/agents/embedded-agent-lsp.ts`
- `tests/unit/runtime-symbol-tool-contracts.test.ts`
- `tests/unit/runtime-symbol-tool-readonly.test.ts`
- `tests/fixtures/symbol-tool/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-b-symbol-readonly-contracts.md
```

## Lane C: AgentMap Render, Budget, And Fixtures

LANE_ID: `line-b-c-agentmap-render-budget-fixtures`

LANE_TITLE: AgentMap renderer, token budget fit, cache invalidation, and snapshots

LANE_SCOPE:

- Render selected symbols as file-grouped source context with stable ranges.
- Fit token budget by reducing selected symbol count and re-rendering.
- Add snapshot fixtures for a small TS/TSX Electron-style workspace.
- Add cache invalidation tests for file content/mtime changes if caching is implemented.
- Do not truncate in the middle of a symbol block.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `tests/unit/runtime-agent-map-renderer.test.ts`
- `tests/unit/runtime-agent-map-budget.test.ts`
- `tests/fixtures/agent-map/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-c-agentmap-render-budget-fixtures.md
```

## Lane D: Context Provider Shadow Boundary

LANE_ID: `line-b-d-context-provider-shadow-boundary`

LANE_TITLE: Explicit AgentMap/Symbol context provider shadow boundary

LANE_SCOPE:

- Add explicit provider factories only after AgentMap or Symbol readonly result contracts exist.
- Use `RuntimeContextProvider` and `RuntimeContextProviderResult`.
- Register providers only through explicit test extra-provider injection or a future default-off helper accepted by spec.
- Prove flag-off parity and default provider ordering unchanged.
- Emit diagnostics/evidence only; do not feed provider output to prompts or TaskLoop decisions.

SUGGESTED_PATHS:

- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
- `openclaw_runtime/src/context-engine/symbol-context-provider.ts`
- `tests/unit/context-provider-registry.test.ts`
- `tests/unit/runtime-agent-map-context-provider.test.ts`
- `tests/unit/runtime-symbol-context-provider.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-d-context-provider-shadow-boundary.md
```

## Lane E: Validation And Synthesis Readiness

LANE_ID: `line-b-e-validation-synthesis-readiness`

LANE_TITLE: Validation, boundary scans, docs/index decision, and synthesis readiness

LANE_SCOPE:

- Confirm Lane A-D submissions exist and have exactly one valid status line.
- Re-verify evidence and classify each lane as accepted, needs_revision, or blocked.
- Run harness context/validate for the future Line B task spec.
- Run focused AgentMap, Symbol Tool, context-provider, and config tests if touched.
- Run typecheck and boundary scans as needed.
- Update `agent-runtime-index.md` only after synthesis accepts actual implementation evidence.

SUGGESTED_PATHS:

- `harness/specs/tasks/<future-line-b-spec>.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/**`
- `runtime-research/agent-runtime-index.md`
- focused tests touched by A-D

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-e-validation-synthesis-readiness.md
```

## Execution Order

1. Lane A and Lane B may start in parallel.
2. Lane C starts after Lane A has stable AgentMap contracts.
3. Lane D starts after Lane A or Lane B has a tested readonly result shape.
4. Lane E starts after A-D submissions exist.
5. Synthesis starts after Lane E.

Lanes must not accept another lane's unverified claims. Each lane needs its own code/test/scan evidence.
