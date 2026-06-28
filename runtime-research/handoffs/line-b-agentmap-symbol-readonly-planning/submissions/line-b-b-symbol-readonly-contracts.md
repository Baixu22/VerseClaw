# line-b-b-symbol-readonly-contracts: Symbol Tool readonly contracts

## Scope Confirmation

- Lane: Line B Phase 3 / Lane B Symbol Tool readonly contracts.
- Runtime code touched:
  - `openclaw_runtime/src/runtime-core/symbols.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Tests touched:
  - `tests/unit/runtime-symbol-tool-contracts.test.ts`
  - `tests/unit/runtime-symbol-tool-readonly.test.ts`
- Documentation touched:
  - this submission file

## Required Reading

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`
- `runtime-research/serena/symbol-api.md`
- `runtime-research/serena/clawx-mapping.md`
- `runtime-research/serena/useful-tests.md`
- `openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts`
- `openclaw_runtime/src/agents/embedded-agent-lsp.ts`
- `openclaw_runtime/src/plugins/bundle-lsp.ts`
- `openclaw_runtime/src/runtime-core/types.ts`
- `openclaw_runtime/AGENTS.md`
- `harness/specs/scenarios/gateway-backend-communication.md`
- `harness/specs/layers/openclaw-runtime.md`
- `harness/specs/rules/backend-communication-boundary.md`
- `harness/specs/rules/docs-sync.md`

Tooling note: `rtk` was not on PATH in this workspace. Direct `node`, `rg`, local Vitest, and local TypeScript commands were used after `rtk` failed.

## Implementation Summary

- Added `openclaw_runtime/src/runtime-core/symbols.ts` with readonly Symbol Tool contracts for:
  - `overview`
  - `find`
  - `references`
  - `diagnostics`
  - `checkpoint`
  - structured `fallback`
- Added type guards for symbol positions/ranges/nodes/overviews/fallbacks/diagnostics.
- Added pure helpers for:
  - LSP document-symbol normalization into stable `RuntimeSymbolNode` trees.
  - same-name lookup with `namePath` disambiguation.
  - cross-file reference grouping with snippets.
  - structured LSP-unavailable failures.
  - checkpoint creation, relocation, and explicit drift reporting.
- Exported the new readonly symbol surface from `openclaw_runtime/src/runtime-core/index.ts`.
- Did not add tool materialization, provider registration, TaskLoop/Gateway wiring, renderer/Main routes, prompt authority, always-on LSP, persistent LSP state, or mutation/edit operations.

## Evidence Table

| Claim | Evidence |
|---|---|
| Readonly operation set is closed to overview/find/references/diagnostics/checkpoint | `openclaw_runtime/src/runtime-core/symbols.ts` defines `RUNTIME_SYMBOL_READONLY_OPERATIONS`; `tests/unit/runtime-symbol-tool-contracts.test.ts` asserts the exact operation list. |
| Document symbols fixture normalizes to stable tree nodes | `buildRuntimeSymbolOverview()` in `openclaw_runtime/src/runtime-core/symbols.ts`; `tests/unit/runtime-symbol-tool-contracts.test.ts` covers parent/child symbol ids, `namePath`, `bodyRange`, and signature. |
| Same-name/namePath disambiguation is structured | `findRuntimeSymbols()` in `openclaw_runtime/src/runtime-core/symbols.ts`; `tests/unit/runtime-symbol-tool-readonly.test.ts` covers ambiguous `render` matches and resolved `["Dashboard", "render"]`. |
| Cross-file references are grouped by file with snippets | `groupRuntimeSymbolReferences()` in `openclaw_runtime/src/runtime-core/symbols.ts`; `tests/unit/runtime-symbol-tool-readonly.test.ts` covers two files and sorted references. |
| LSP unavailable returns structured fallback/error | `createLspUnavailableSymbolResult()` in `openclaw_runtime/src/runtime-core/symbols.ts`; both symbol test files assert `symbol.lsp_unavailable` diagnostics and retryable fallback. |
| Checkpoint relocation/drift is explicit | `createRuntimeSymbolCheckpoint()` and `resolveRuntimeSymbolCheckpoint()` in `openclaw_runtime/src/runtime-core/symbols.ts`; `tests/unit/runtime-symbol-tool-readonly.test.ts` covers relocated range and content-hash drift. |
| Session-scoped LSP lower layer was reused conceptually, not replaced | Required read of `agent-bundle-lsp-runtime.ts`, `embedded-agent-lsp.ts`, and `bundle-lsp.ts` confirmed existing LSP lifecycle is session-scoped spawn/dispose. This lane adds contracts only and no new process lifecycle. |
| No mutation surface landed | Required mutation scan over touched symbol runtime/test files returned no matches for edit operation patterns. |
| No new service/listener/daemon/database landed | Required service/listener scan over touched symbol runtime/test files returned no matches. |

## Boundary Evidence

| Boundary | Result | Evidence |
|---|---|---|
| No rename/body replace/insert/delete/workspace edit behavior | pass | `rg -n 'rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply' openclaw_runtime/src/runtime-core/symbols.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts` returned no matches. |
| No AST patch behavior | pass | Same mutation scan returned no matches. |
| No always-on LSP service/listener/daemon | pass | `rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(' openclaw_runtime/src/runtime-core/symbols.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts` returned no matches. |
| No provider default registration | pass | No provider registry or context-provider files were touched in this lane. |
| No TaskLoop/Gateway/model prompt cutover | pass | No TaskLoop, Gateway, renderer, Main, host-api, api-client, or prompt assembly files were touched. |
| No durable LSP process checkpoint | pass | Checkpoint contract stores symbol identity/ranges/content hash only; no LSP process/session state is serialized. |
| Docs sync | pass | README translations were reviewed for Symbol Tool entries and had no matching user-facing section requiring updates. This is an internal runtime-core contract/test foundation. |

## Validation

- `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` passed and returned the expected read order.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` passed.
- `.\node_modules\.bin\vitest.cmd run tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts` passed: 2 files / 8 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.node.json --composite false` passed.
- `git diff --check -- openclaw_runtime/src/runtime-core/symbols.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts` passed with only the existing CRLF warning on `runtime-core/index.ts`.

Validation limitation:

- `pnpm harness context`, `pnpm harness validate`, and `pnpm exec vitest ...` were blocked by the current pnpm ignored-builds approval gate (`ERR_PNPM_IGNORED_BUILDS`). Direct Node harness CLI and local tool binaries were used instead.
- `node scripts/run-vitest.mjs ...` was attempted per `openclaw_runtime/AGENTS.md`, but this checkout does not contain `scripts/run-vitest.mjs`.

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence |
|---|---|---|
| Existing bundled LSP tools | Unchanged; hover/definition/references materialization remains in `agent-bundle-lsp-runtime.ts`. | No edits to agent LSP runtime files. |
| Existing read/grep/find/ls behavior | Unchanged; Symbol contracts do not replace tool selection or fallback transport. | No tool registry, provider, or TaskLoop files touched. |
| Renderer/Main transport | Unchanged. | No renderer/Main/host-api/api-client files touched. |
| Prompt/context authority | Unchanged. | No provider registration or prompt assembly files touched. |

## Open Questions

| Question | Why It Matters | Blocking |
|---|---|---|
| Which concrete LSP adapter should consume these contracts first? | This lane intentionally stops at pure contracts/tests and does not expose a runtime tool. | no |
| Should future diagnostics include language-server-specific capability details? | Useful for fallback UX, but should be added only when a real session adapter exists. | no |

Status: accepted
