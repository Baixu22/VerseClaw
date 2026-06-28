# lane-c-tool-provider-diagnostics-expansion: Broader tool provider shadow diagnostics beyond the initial MCP path

## Scope Confirmation

- Lane: lane-c-tool-provider-diagnostics-expansion
- Output file: runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-c-tool-provider-diagnostics-expansion.md
- Lane-owned file only: yes
- Implementation paths touched: electron/services/tool-provider-registry.ts
- Test paths touched: tests/unit/tool-provider-registry.test.ts; tests/unit/mcp-api.test.ts
- Commands run: focused unit slice; typecheck; comms replay; comms compare
- Required reading completed: yes

## Executive Summary

- Expanded MCP tool-provider diagnostics for unsupported MCP content, provider exceptions, denied, waiting, cancelled-like outcomes, and normalized error categories.
- Preserved legacy `McpCallToolResult` identity and key shape.
- Added a built-in host Git tool diagnostic shape through the existing `clawx-git` MCP adapter seam, with `noNewTransport: true`.
- Kept registry shadows behind `runtime.toolRegistry.shadow`; no visible tools or tool authority changed.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Unsupported MCP content normalized | test | tests/unit/tool-provider-registry.test.ts | unsupported content test | Reason `unsupported_content`. |
| Provider exceptions normalized | test | tests/unit/tool-provider-registry.test.ts | exception test | Reason `provider_exception`. |
| Waiting/denied/cancelled outcomes normalized | test | tests/unit/tool-provider-registry.test.ts | diagnostics expansion test | Statuses `waiting`, `denied`, `cancelled`. |
| Built-in host tool shape uses existing seam | test | tests/unit/mcp-api.test.ts | built-in Git diagnostic test | No new transport. |
| Comms checks pass | command | pnpm --config.verify-deps-before-run=false run comms:replay; pnpm --config.verify-deps-before-run=false run comms:compare | pass | Needed because Electron service path touched. |

## Collector Surface

| Surface | Contract / Adapter | Shadow Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| MCP tool diagnostics | `createMcpToolProviderRegistryResultShadow()` diagnostics | legacy result authoritative | `runtime.toolRegistry.shadow` | tool-provider-registry and mcp-api tests |
| Built-in Git diagnostic shape | existing `mcp-api.callTool` `clawx-git` seam | diagnostic metadata only | `runtime.toolRegistry.shadow` | mcp-api test |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| MCP callTool success | Same object returned | existing and expanded tests | Low |
| Approval waiting | Still adapter metadata; no policy cutover | tool-provider-registry approval test | Low |
| Built-in Git MCP | Same success result shape | mcp-api built-in tests | Low |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Focused unit slice | pnpm --config.verify-deps-before-run=false exec vitest run ... | pass | Tool/MCP diagnostics | None |
| Comms replay | pnpm --config.verify-deps-before-run=false run comms:replay | pass | Main communication replay | First attempt without config was blocked by pnpm install gate |
| Comms compare | pnpm --config.verify-deps-before-run=false run comms:compare | pass | Comms regression compare | None |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No provider ordering/default registration cutover | pass | No providers registered by default |
| No tool response/approval semantic drift | pass | Response identity/key tests pass |
| No TaskLoop authority drift | pass | Tool lane emits sink records only |
| No renderer direct IPC/Gateway bypass | pass | Renderer scan no matches |
| No second runtime service/listener | pass | Prod touched-file service scan no matches |
| Comms replay/compare handled if required | pass | Both rerun with dependency verification disabled |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Built-in Git tool is exposed through MCP compatibility adapter | Existing safe seam is `clawx-git` in mcp-api | Add only diagnostic shape, no new transport | Accepted for MVP |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: broader built-in tool adapter inventory
New code path: none by default
Legacy path wrapped: existing safe adapters only
Shadow boundary: diagnostics only
Feature flag: runtime.toolRegistry.shadow plus collector flag for TaskLoop injection
Tests: tool-provider-registry and mcp-api
Harness: clean-diff validate
Rollback: omit runtime.toolRegistry.shadow
Done when: another non-MCP seam is proven without adding transport
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `policy_waiting` replace all earlier `policy_denied` waiting diagnostics? | Improves taxonomy precision | maintainer | no |

## Handoff Notes

No MCP response shape, retry behavior, approval semantics, visible catalog behavior, Gateway request payload, or provider transport was changed.
