# Line B Lane C: AgentMap Render, Budget, And Fixtures

## Scope

Implemented the Phase 2 AgentMap renderer and budget fit slice over the accepted Phase 1 AgentMap contracts. The output remains readonly diagnostic/test data only; it is not registered as a default provider and is not injected into TaskLoop, Gateway, chat, model messages, or runtime prompt assembly.

## Files Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/development-phases.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/parallel-lanes.md`
- `runtime-research/aider/algorithms.md`
- `runtime-research/aider/clawx-mapping.md`
- `runtime-research/aider/useful-tests.md`
- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `openclaw_runtime/src/agents/loop-context-pack.ts`
- `tests/unit/runtime-agent-map-contracts.test.ts`

Tooling note: `rtk` was not available on PATH in this environment. Focused tests were run with the local Vitest binary, and harness validation was run directly through `node harness/src/cli.mjs` because the `pnpm harness ...` wrapper triggered the current ignored-build-scripts install gate.

## Files Changed

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `tests/unit/runtime-agent-map-ranking.test.ts`
- `tests/unit/runtime-agent-map-renderer.test.ts`
- `tests/unit/runtime-agent-map-budget.test.ts`
- `tests/fixtures/agent-map/fixture-loader.ts`
- `tests/fixtures/agent-map/expected/diagnostic-map.txt`
- `tests/fixtures/agent-map/tsx-electron-workspace/**`

## Implementation Evidence

| Claim | Evidence |
|---|---|
| TS/TSX readonly tag extraction exists. | `extractAgentMapTagsFromSources` in `openclaw_runtime/src/runtime-core/agent-map.ts:644`; tested by `tests/unit/runtime-agent-map-ranking.test.ts:12`. |
| Aider-inspired ranking uses active references, mentions, path components, and reference-to-definition links. | `rankAgentMapTags` in `openclaw_runtime/src/runtime-core/agent-map.ts:651`; active-file reference test at `tests/unit/runtime-agent-map-ranking.test.ts:43`; exact mentioned identifier test at `tests/unit/runtime-agent-map-ranking.test.ts:60`. |
| Renderer emits complete file-grouped symbol blocks with stable line/range metadata. | `renderAgentMapRankedTags` in `openclaw_runtime/src/runtime-core/agent-map.ts:789`; symbol block renderer at `openclaw_runtime/src/runtime-core/agent-map.ts:1475`; snapshot test at `tests/unit/runtime-agent-map-renderer.test.ts:14`. |
| Budget fitting reduces selected symbol count and re-renders instead of truncating text. | `buildBudgetedAgentMapResult` in `openclaw_runtime/src/runtime-core/agent-map.ts:838`; `fitAgentMapRenderToBudget` in `openclaw_runtime/src/runtime-core/agent-map.ts:1535`; monotonic budget test at `tests/unit/runtime-agent-map-budget.test.ts:12`. |
| Renderer does not cut a symbol block in the middle. | Block start/end parity and tag-id end marker checks in `tests/unit/runtime-agent-map-budget.test.ts:42`. |
| Snapshot fixture is deterministic. | `tests/fixtures/agent-map/expected/diagnostic-map.txt:1` is compared exactly by `tests/unit/runtime-agent-map-renderer.test.ts:14`. |

## Validation Evidence

| Command | Result |
|---|---|
| `.\node_modules\.bin\vitest.CMD run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts` | pass: 4 files, 10 tests |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` | pass: spec valid |
| `rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" openclaw_runtime/src/runtime-core/agent-map.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/fixtures/agent-map` | pass: no matches |
| `rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" openclaw_runtime/src/runtime-core/agent-map.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/fixtures/agent-map` | pass: no matches |

## Boundary Confirmation

- No default AgentMap provider registration was added.
- No TaskLoop, Gateway, chat, model-message, provider-ordering, renderer, Electron Main, host-api, or api-client paths were changed for this lane.
- No read/grep/find/ls behavior was replaced or wrapped.
- No mutating symbol operation, AST patch apply, rename, safe delete, workspace edit, service, listener, daemon, external database, or always-on LSP service was introduced.
- AgentMap output remains readonly diagnostic/test output backed by fixtures and unit tests.

## Residual Notes

- `pnpm harness ...` remains blocked by the environment's ignored-build-scripts install gate. Direct Node harness validation passed and was used as the recorded spec validation path.
- No README operator-facing docs update is required because this lane adds no user-visible runtime behavior and does not alter application flows.

Status: accepted
