# lane-c-tool-provider-registry-pilot: Tool provider registry over MCP callTool compatibility provider

## Scope Confirmation

- Lane: `lane-c-tool-provider-registry-pilot`
- Output file: `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-c-tool-provider-registry-pilot.md`
- Lane-owned file only: yes
- Implementation paths touched: `electron/services/tool-provider-registry.ts`; `electron/services/mcp-api.ts`
- Test paths touched: `tests/unit/tool-provider-registry.test.ts`
- Commands run: `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts`; `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`; `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff`; `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'`; `rtk node scripts/comms/replay.mjs`; `rtk node scripts/comms/compare.mjs`
- Required reading completed: yes; read Phase-3 handoff docs/task spec in this workstream and Lane-C-specific `runtime-research/continue/tool-provider.md` plus `runtime-research/continue/useful-tests.md` before implementation.

## Executive Summary

- Added `electron/services/tool-provider-registry.ts` as the MCP `callTool` compatibility provider registry pilot wrapper.
- The provider manifest is shadow-only, disabled by default, uses runtime-core `RuntimeToolProviderManifest`, and records `ask` policy metadata while preserving existing MCP approval semantics.
- `createMcpApiWithContext().callTool` now emits optional registry request/result shadows behind `runtime.toolRegistry.shadow` without changing the returned `McpCallToolResult` object or JSON/key shape.
- The registry result shadow reuses the existing MCP tool protocol shadow adapter output, so normalized evidence is a canonical `ToolCallResult` rather than a duplicated contract.
- Approval waiting, blocked, and error states remain adapter metadata (`adapterStatus`, `adapterReason`, `approval`) and do not cut over to a new permission system.
- No visible MCP tools/catalog entries were added; `listTools` behavior is untouched.
- Added `tests/unit/tool-provider-registry.test.ts` covering manifest shape, success parity, approval-waiting metadata, and flag-off no-op behavior.
- Ran the required `mcp-api.test.ts` plus new tests; 2 files / 16 tests passed.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| MCP callTool has a shadow-only compatibility provider manifest. | file | `electron/services/tool-provider-registry.ts` | `MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST` lines 15-48 | `enabledByDefault: false`, `shadowOnly: true`, `source: 'mcp'`, `toolNames: ['mcp.callTool']`. |
| Provider manifest includes policy/fallback metadata without permission cutover. | file | `electron/services/tool-provider-registry.ts` | manifest lines 26-34; diagnostics lines 126-159 | Permission decision is `ask`; fallback reasons include `legacy_authoritative`, `provider_error`, `policy_denied`, `no_result`. |
| Registry shadows are feature-flagged and non-fatal. | file | `electron/services/tool-provider-registry.ts` | `isMcpToolProviderRegistryShadowEnabled` lines 100-104; `emitMcpToolProviderRegistryShadow` lines 106-115 | Emits only when `runtime.toolRegistry.shadow === true`; sink errors are swallowed. |
| Existing MCP shadow adapter is wrapped as provider result evidence. | file | `electron/services/tool-provider-registry.ts`; `electron/services/mcp-api.ts` | `createMcpToolProviderRegistryResultShadow` lines 184-210; `finish` integration lines 1081-1090 | Registry result stores `ToolCallResult` from `createMcpToolCallResultShadow`. |
| Legacy `McpCallToolResult` shape remains unchanged. | test | `tests/unit/tool-provider-registry.test.ts` | success test lines 57-125; approval test lines 133-187 | Tests assert `result === legacy`, `JSON.stringify` parity, and exact `Object.keys`. |
| Approval waiting remains adapter metadata. | test | `tests/unit/tool-provider-registry.test.ts` | approval test lines 133-187 | Asserts `adapterStatus: 'waiting'`, `adapterReason.code: 'permission/waiting'`, and `approval` metadata while legacy response is unchanged. |
| Flag off emits no registry shadows. | test | `tests/unit/tool-provider-registry.test.ts` | flag-off test lines 190-212 | `runtime.toolRegistry.shadow: false` leaves sink uncalled. |
| Required focused tests pass. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts` | pass: 2 files / 16 tests | Covers existing MCP behavior plus new registry pilot wrapper. |
| Node TypeScript check passes. | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Verifies typed Main/runtime imports and new context shape. |
| Harness spec validates. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Phase-3 task spec remains structurally valid. |
| Renderer boundary remains clean for this lane. | command | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed | Matches are existing preload/Main/tests/rule text; no renderer files touched by Lane C. |
| Comms regression scripts pass. | command | `rtk node scripts/comms/replay.mjs`; `rtk node scripts/comms/compare.mjs` | pass | Ran because this lane touches `electron/services/mcp-api.ts`. |

## Implementation Summary

Current code:

- `electron/services/tool-provider-registry.ts` declares `MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST`, registry shadow record types, flag-gated emitter, request/result shadow builders, and diagnostics that reference the legacy MCP path and normalized tool-protocol shadow output.
- `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` now optionally emits `tool_provider.request` and `tool_provider.result` shadows through `toolProviderRegistryShadowSink` when `runtime.toolRegistry.shadow` is enabled.
- `mcp-api.ts` still returns the same legacy `McpCallToolResult` values from `finish(...)`; registry emission is observational and does not mutate the result object.

Tests:

- `tests/unit/tool-provider-registry.test.ts` verifies manifest validation, success shape parity, normalized `ToolCallResult` evidence, approval waiting as metadata, and flag-off behavior.
- Existing `tests/unit/mcp-api.test.ts` was run unchanged with the new test file to ensure prior MCP server/catalog/tool-call behavior still passes.

Feature flags:

- Registry wrapper uses `runtime.toolRegistry.shadow` only.
- Existing `runtime.toolProtocol.mcpShadow` remains independent; one test proves registry shadows can run while protocol shadows are off, with no legacy response change.

Harness/spec changes:

- No harness spec files were changed by this lane.
- Phase-3 harness validation passed.

## Registry Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| MCP callTool provider manifest | `MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST` (`RuntimeToolProviderManifest`) | shadow-only / flag-off | `runtime.toolRegistry.shadow` | `electron/services/tool-provider-registry.ts` lines 15-48 |
| Registry request shadow | `createMcpToolProviderRegistryRequestShadow(requestShadow)` | diagnostics only; no execution | `runtime.toolRegistry.shadow` | `electron/services/tool-provider-registry.ts` lines 171-181; `electron/services/mcp-api.ts` lines 1094-1097 |
| Registry result shadow | `createMcpToolProviderRegistryResultShadow(requestShadow, resultShadow, legacyResult)` | diagnostics + normalized `ToolCallResult`; legacy response authoritative | `runtime.toolRegistry.shadow` | `electron/services/tool-provider-registry.ts` lines 184-210; `electron/services/mcp-api.ts` lines 1081-1090 |
| Existing MCP adapter reuse | `createMcpToolCallRequestShadow` / `createMcpToolCallResultShadow` remain the normalizer | wrapped by registry pilot; no duplicate result contract | `runtime.toolProtocol.mcpShadow` independent; registry uses `runtime.toolRegistry.shadow` | `electron/services/mcp-api.ts` lines 1070-1097 |
| Provider sink | `toolProviderRegistryShadowSink?: (record) => void` | optional diagnostic sink only | `runtime.toolRegistry.shadow` | `electron/services/mcp-api.ts` line 53; `electron/services/tool-provider-registry.ts` lines 91-115 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` success path | Returns the exact runtime `McpCallToolResult` object unchanged. | `tests/unit/tool-provider-registry.test.ts` lines 57-125 asserts identity, JSON parity, and key order; required Vitest command passed. | Low; future lanes must not consume registry result as authoritative until cutover. |
| MCP approval waiting / blocked path | Legacy blocked/approval fields stay on `McpCallToolResult`; registry records metadata only. | `tests/unit/tool-provider-registry.test.ts` lines 133-187 asserts exact legacy keys and registry `adapterStatus: 'waiting'`. | Medium; future policy evaluator work must keep approval semantics until explicit cutover. |
| MCP protocol shadow path | Existing `runtime.toolProtocol.mcpShadow` request/result records are unchanged and independent. | `tests/unit/mcp-api.test.ts` passed; new test verifies registry shadows can run while protocol sink is not called. | Low. |
| MCP visible catalog / built-in Git tools | No visible MCP tool or catalog addition. | `electron/services/mcp-api.ts:listTools` not modified; `tests/unit/mcp-api.test.ts` existing catalog tests passed. | Low. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Required Lane C focused test command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts` | pass, 2 files / 16 tests | Existing MCP API behavior and new registry pilot wrapper | None |
| TypeScript node check | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Type safety for `mcp-api.ts` and new registry helper | None |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Phase-3 task spec validity | None |
| Boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | pass/reviewed | Renderer/Main and Gateway bypass constraints | Existing matches are unrelated allowed/test/rule-text occurrences; no Lane C renderer files touched. |
| Comms replay | `rtk node scripts/comms/replay.mjs` | pass | Communication regression replay after touching `mcp-api.ts` | None |
| Comms compare | `rtk node scripts/comms/compare.mjs` | pass | Communication baseline compare after touching `mcp-api.ts` | None |
| E2E | Playwright targeted E2E | not-run | User-visible UI | Not required: no UI or visible MCP catalog behavior changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Added one Electron Main helper module and optional in-process diagnostics; no daemon, port, server, Gateway instance, or `verseshell-runtime` authority was added. |
| No renderer direct IPC | pass | No renderer files touched; boundary scan reviewed existing non-lane matches only. |
| No renderer direct Gateway HTTP/WS | pass | No renderer transport code touched; boundary scan reviewed existing non-lane matches only. |
| Feature flags default safe | pass | `isMcpToolProviderRegistryShadowEnabled` requires `runtime.toolRegistry.shadow === true`; flag-off test confirms no emission. |
| Flag-off parity covered | pass | `tests/unit/tool-provider-registry.test.ts` flag-off test plus existing `tests/unit/mcp-api.test.ts` pass. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Registry result shadow stores both legacy metadata and canonical `ToolCallResult`. | `electron/services/tool-provider-registry.ts` lines 70-86 and 184-210 | Keep legacy `McpCallToolResult` authoritative while exposing normalized evidence. | Synthesis should accept this as shadow-only; future cutover must add parity gates before using `ToolCallResult` as return authority. |
| `policy_denied` diagnostic reason is used for approval waiting, but no actual deny occurs. | `tests/unit/tool-provider-registry.test.ts` lines 169-183 | Approval waiting / ask remains adapter metadata, not permission-system cutover. | Future policy evaluator should introduce a more precise registry reason if needed; do not change current approval behavior in Phase 3. |
| Large pre-existing workspace modifications make raw `git diff` noisy. | `rtk git status --short` shows many unrelated dirty/untracked files from other lanes/phases. | Lane C should claim only declared paths. | Synthesis should evaluate only `electron/services/tool-provider-registry.ts`, the small `mcp-api.ts` integration, `tests/unit/tool-provider-registry.test.ts`, and this submission. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Extend registry wrapper coverage to MCP unsupported content normalization and non-MCP built-in tools.
New code path: Additional compatibility tool providers that reuse runtime-core ToolCallResult without changing legacy responses.
Legacy path wrapped: Existing MCP/built-in tool call sites remain authoritative.
Shadow / pilot boundary: tool_provider.* diagnostics only; no visible tool/catalog or permission-system cutover.
Feature flag: runtime.toolRegistry.shadow plus tool-specific shadow flags where already proven.
Tests: Add unsupported MCP content, thrown provider exception, and flag-off shape parity fixtures.
Harness: Keep validating harness/specs/tasks/phase-3-provider-tool-registry-pilot.md and run comms replay/compare for Main communication edits.
Rollback: Disable runtime.toolRegistry.shadow or remove the provider sink wiring; legacy callTool returns stay unchanged.
Done when: Success/error/blocked/approval waiting paths all produce normalized evidence while legacy McpCallToolResult remains byte/shape equivalent.
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should approval waiting use a dedicated registry diagnostic reason instead of `policy_denied`? | It would more accurately distinguish ask/wait from deny while preserving current semantics. | maintainer/agent | no |
| Should registry and protocol shadow sinks later merge under one diagnostic event channel? | Current separation avoids widening existing `McpToolCallShadowRecord` and keeps tests/source compatibility. | maintainer/agent | no |

## Handoff Notes

- This lane intentionally adds no visible MCP tools and does not alter `listTools` output.
- The compatibility provider is not a new runtime service; it is an in-process Electron Main diagnostic wrapper around the existing MCP `callTool` adapter.
- `runtime.toolRegistry.shadow` can be disabled independently from `runtime.toolProtocol.mcpShadow`; disabling it fully rolls back Lane C behavior.
- Future lanes should keep `McpCallToolResult` authoritative until a synthesis-approved cutover plan adds parity tests and rollback gates.
