# lane-c-tool-protocol-shadow: MCP Tool Protocol Shadow

## Scope Confirmation

- Lane: `lane-c-tool-protocol-shadow`
- Output file: `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-c-tool-protocol-shadow.md`
- Lane-owned file only: yes
- Files/directories searched: `electron/services/tool-protocol-shadow.ts`, `electron/services/mcp-api.ts`, `tests/unit/mcp-api.test.ts`, `openclaw_runtime/src/runtime-core`
- Commands run:
  - `rtk rg -n "mcpShadow|ToolCallRequest|ToolCallResult|createMcpToolCallRequestShadow|createMcpToolCallResultShadow" electron/services/tool-protocol-shadow.ts electron/services/mcp-api.ts tests/unit/mcp-api.test.ts`
  - `rtk rg -n "clawx-codegraph|VERSE_CLAW_CODEGRAPH|Verse Claw CodeGraph" electron/services/mcp-api.ts tests/unit/mcp-api.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts`
- Prior handoffs reviewed: Phase-1 synthesis, Phase-2 synthesis, Phase-2 README/template

## Executive Summary

- MCP `callTool` has a shadow adapter that creates runtime-core `ToolCallRequest` / `ToolCallResult` records.
- The shadow adapter imports canonical runtime-core types from `openclaw_runtime/src/runtime-core`; it does not define duplicate same-name contracts.
- Shadow emission is gated by `runtime.toolProtocol.mcpShadow`.
- Focused shadow tests prove legacy response object/JSON/enumerable shape is unchanged when shadow is enabled and no shadow emits when flag is off.
- Failure, thrown exception, permission waiting, and Gateway unavailable/blocked cases are mapped into canonical `ToolCallResult.status: "error"` with bridge metadata.
- Full `tests/unit/mcp-api.test.ts` now passes, so no visible MCP catalog drift remains as a Phase-2 blocker.
- Search evidence shows `clawx-codegraph` is not currently exposed from `electron/services/mcp-api.ts` or expected by `tests/unit/mcp-api.test.ts`.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| MCP shadow adapter imports canonical runtime-core types. | file | `electron/services/tool-protocol-shadow.ts` | imports lines 3-9 | Imports `ToolCallRequest` / `ToolCallResult` from `../../openclaw_runtime/src/runtime-core`. |
| MCP shadow feature flag exists. | file | `electron/services/tool-protocol-shadow.ts` | `ToolProtocolShadowRuntimeFlags`, lines 11-17 | `runtime.toolProtocol.mcpShadow`. |
| Bridge metadata uses local `blocked/waiting` states separate from canonical result status. | file | `electron/services/tool-protocol-shadow.ts` | `McpToolCallBridgeState`, line 27 | Adapter metadata only. |
| Shadow emission is gated. | file | `electron/services/tool-protocol-shadow.ts` | `isMcpToolProtocolShadowEnabled`, `emitToolProtocolShadow`, lines 221-233 | No sink call unless flag and sink exist. |
| MCP request shadow builds a canonical `ToolCallRequest`. | file | `electron/services/tool-protocol-shadow.ts` | `createMcpToolCallRequestShadow`, lines 237-281 | Includes call id, task id, args, permission context. |
| MCP result shadow builds a canonical `ToolCallResult`. | file | `electron/services/tool-protocol-shadow.ts` | `createMcpToolCallResultShadow`, lines 282-360 | Maps success/error/waiting/blocked. |
| MCP thrown errors map to runtime error result shadows. | file | `electron/services/tool-protocol-shadow.ts` | `createMcpToolCallThrownErrorShadow`, lines 362-371 | Produces `status: error`. |
| `mcp-api` emits request/result shadows around legacy `callTool`. | file | `electron/services/mcp-api.ts` | imports lines 27-32; request/finish calls around `callTool` | Shadow side channel around existing call. |
| Focused success shadow test preserves legacy response shape. | test | `tests/unit/mcp-api.test.ts` | lines 288-357 | Asserts object identity, JSON, keys, and runtime-core validators. |
| Focused flag-off test emits no shadow and preserves legacy response shape. | test | `tests/unit/mcp-api.test.ts` | lines 360-384 | Covers flag-off behavior. |
| Focused failure/exception/waiting/blocked mapping tests exist. | test | `tests/unit/mcp-api.test.ts` | lines 387-543 | Covers error, thrown exception, approval waiting, gateway unavailable. |
| Focused shadow test command passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow` | result: pass, 5 tests / 7 skipped | Shadow-only focused test evidence. |
| Full MCP unit test command passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts` | result: pass, 1 file / 12 tests | Covers registry, built-in Git catalog/calls, and shadow tests. |
| Full combined runtime/MCP run passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 4 files / 64 tests | Proves lane-c no longer blocks combined Phase-2 validation. |
| No `clawx-codegraph` built-in MCP exposure remains in the audited MCP files. | missing-after-search | `rtk rg -n "clawx-codegraph|VERSE_CLAW_CODEGRAPH|Verse Claw CodeGraph" electron/services/mcp-api.ts tests/unit/mcp-api.test.ts` | no matches | Removes prior visible-catalog blocker. |

## Current State

Current code:

- `electron/services/tool-protocol-shadow.ts` maps MCP payload/result shapes into canonical runtime-core tool request/result records.
- `electron/services/mcp-api.ts` emits shadows around `callTool` when the feature flag and sink are provided.
- No `clawx-codegraph` visible built-in MCP server is present in the audited MCP API/test files.

Current tests:

- Focused shadow tests pass.
- Full `tests/unit/mcp-api.test.ts` passes.
- Full combined runtime/MCP test slice passes.

Current harness specs:

- `harness/specs/tasks/lane-c-tool-protocol-shadow.md` exists and validates structurally with `--no-diff`.

Existing handoff notes:

- Prior Phase-2 synthesis recorded a `clawx-codegraph` blocker. Current search and full test results supersede that stale blocker.

## Shadow Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| MCP request | `McpCallToolPayload` -> runtime-core `ToolCallRequest` | shadow-only | `runtime.toolProtocol.mcpShadow` | `tool-protocol-shadow.ts:237`-`:281` |
| MCP result | `McpCallToolResult` -> runtime-core `ToolCallResult` | shadow-only | `runtime.toolProtocol.mcpShadow` | `tool-protocol-shadow.ts:282`-`:360` |
| MCP thrown exception | thrown error -> runtime-core `ToolCallResult.status = "error"` | shadow-only | `runtime.toolProtocol.mcpShadow` | `tool-protocol-shadow.ts:362`-`:371` |
| Legacy `mcp.callTool` | Original return object unchanged | shadow-only | `runtime.toolProtocol.mcpShadow` | `tests/unit/mcp-api.test.ts:288`-`:384` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| External/Gateway MCP call result | Legacy object returned to caller. | `tests/unit/mcp-api.test.ts:315`-`:317` and `:381`-`:383`. | Full MCP test now passes. |
| Approval-required result | Remains legacy blocked/approval result; shadow records waiting metadata. | `tests/unit/mcp-api.test.ts:435`-`:472`. | Pending approval taxonomy must remain adapter metadata until canonical permission events exist. |
| Built-in Git MCP catalog | Existing Git catalog remains visible and tested. | `tests/unit/mcp-api.test.ts:545`-`:566` and full MCP pass. | Future additional built-ins need separate spec/tests. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| MCP focused shadow run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow` | pass | MCP shadow on/off and mapping cases. | Focused only. |
| Full MCP unit run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts` | pass | Registry, Git built-in catalog/calls, shadows. | Does not run typecheck. |
| Full combined runtime/MCP run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | pass | Phase-2 runtime core slices together. | E2E covered in lane-f. |
| Harness structure | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/lane-c-tool-protocol-shadow.md --no-diff` | pass | Spec schema/structure. | `--no-diff` does not prove scoped changes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Bridge states include `blocked/waiting` while canonical `ToolCallResult.status` does not. | `tool-protocol-shadow.ts:27` and `types.ts:114`. | Canonical tool result statuses remain `success/error/denied/cancelled`. | Keep `blocked/waiting` only in `shadow` metadata and `structuredData`. |
| Future visible built-in MCP catalogs could hide inside shadow work. | Prior stale audit found this risk; current MCP files have no `clawx-codegraph` hits. | Phase 2 should remain shadow-only. | Require separate spec/tests for any future visible built-in server. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Extend tool protocol shadows beyond MCP
New code path: future compatibility adapters for Gateway RPC and selected built-in host tools
Legacy path wrapped: electron/services/mcp-api.ts:createMcpApiWithContext().callTool remains the proven first seam
Shadow / warning boundary: runtime.toolProtocol.* shadows only
Feature flag: runtime.toolProtocol.mcpShadow for MCP; new flags for other providers
Tests: keep full tests/unit/mcp-api.test.ts passing; add provider-specific flag-off parity tests
Harness: lane-c-tool-protocol-shadow plus future provider-tool-adapter-shadow
Rollback: disable shadow flags; legacy callTool remains authoritative
Done when: non-MCP tool-like paths normalize to canonical ToolCallResult shadows without legacy response changes
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should permission waiting become a task event rather than `ToolCallResult.status = "error"` plus metadata? | Core spec treats waiting as task state, not tool result status. | maintainer | no for Phase 2, yes before registry cutover |
| Which non-MCP tool-like path should be normalized next? | Determines Phase 3/4 adapter ordering. | maintainer | no |

## Handoff Notes

- The earlier `clawx-codegraph` blocker is stale in the current checkout: exact MCP-file search has no matches and full MCP tests pass.
- This lane accepts only the MCP shadow adapter and its tests, not any future visible built-in MCP catalog changes.
