# lane-a-registry-contracts-and-flags: Runtime provider/tool registry contracts, manifests, feature flags

## Scope Confirmation

- Lane: `lane-a-registry-contracts-and-flags`
- Output file: `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-a-registry-contracts-and-flags.md`
- Lane-owned file only: yes
- Implementation paths touched: `openclaw_runtime/src/runtime-core/registries.ts`; `openclaw_runtime/src/runtime-core/registry.ts`; `openclaw_runtime/src/runtime-core/index.ts`; `openclaw_runtime/src/config/types.openclaw.ts`; `openclaw_runtime/src/config/zod-schema.ts`; `openclaw_runtime/src/config/schema.labels.ts`; `openclaw_runtime/src/config/schema.help.ts`
- Test paths touched: `tests/unit/runtime-provider-tool-registry.test.ts`
- Commands run: `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`; `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-provider-tool-registry.test.ts`; `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-provider-tool-registry.test.ts`; `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`; `rtk pnpm run typecheck:node`; `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff`; `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'`; `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|18789' openclaw_runtime/src/runtime-core tests/unit/runtime-provider-tool-registry.test.ts`
- Required reading completed: yes; read RTK, Phase-3 required handoff docs, Phase-2 synthesis, runtime index/plan/roadmap/core spec, task spec, and harness context scenario/rules/layers.

## Executive Summary

- Added Phase-3 runtime-owned registry contracts in `openclaw_runtime/src/runtime-core/registries.ts` and exported them from `openclaw_runtime/src/runtime-core/index.ts`.
- Kept `openclaw_runtime/src/runtime-core/registry.ts` as a one-line re-export so there is one canonical registry implementation instead of duplicate runtime-core registry types.
- Defined context/tool provider manifests with ids, capabilities, priority/order metadata, permission decisions, fallback reason codes, diagnostics, validation helpers, and isolated error shape.
- Added empty-by-default `RuntimeContextProviderRegistry` and `ToolProviderRegistry`; no providers/tools are registered unless future lanes explicitly pass them.
- Added default-off flag helpers for `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, `runtime.contextProviders.registryPilot`, and `runtime.toolRegistry.shadow`.
- Extended config type/schema/help/labels for Phase-3 registry flags and existing Phase-2 shadow flags; absence still means default off.
- Added `tests/unit/runtime-provider-tool-registry.test.ts` for flags, manifests, deterministic ordering, duplicate isolation, typed error diagnostics, config strictness, and normalized provider outputs.
- Legacy context/MCP/task-loop behavior remains authoritative; no renderer/Main transport code or runtime service was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Registry contracts/manifests live in runtime core and import canonical runtime-core result types. | file | `openclaw_runtime/src/runtime-core/registries.ts` | `RuntimeContextProviderManifest` line 122; `RuntimeToolProviderManifest` line 128; `RuntimeContextProviderResult` line 159; `RuntimeToolProvider` line 176 | Uses `ContextItem`, `ToolCallRequest`, `ToolCallResult`, and `ToolCallResultStatus` from `./types.js`; no new `ToolCallResult` shape. |
| Registry feature flags default off and only explicit `true` enables them. | file | `openclaw_runtime/src/runtime-core/registries.ts` | `RUNTIME_REGISTRY_FLAG_PATHS` line 19; `DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS` line 30; `resolveRuntimeRegistryFeatureFlags` line 437 | `tests/unit/runtime-provider-tool-registry.test.ts:61` covers absent/default false and explicit true. |
| Registries do not register active providers by default. | file | `openclaw_runtime/src/runtime-core/registries.ts` | `RuntimeContextProviderRegistry` line 499; `ToolProviderRegistry` line 542 | Constructors default to `providers: []`; `tests/unit/runtime-provider-tool-registry.test.ts:124` asserts size `0`. |
| Provider/tool errors are isolated as diagnostics and typed runtime errors. | file | `openclaw_runtime/src/runtime-core/registries.ts` | `isolateRuntimeRegistryError` line 591 | `tests/unit/runtime-provider-tool-registry.test.ts:184` validates diagnostic + `RuntimeError` evidence. |
| Config accepts Phase-3 flags but keeps them optional/default-off. | config | `openclaw_runtime/src/config/types.openclaw.ts`; `openclaw_runtime/src/config/zod-schema.ts`; `openclaw_runtime/src/config/schema.labels.ts`; `openclaw_runtime/src/config/schema.help.ts` | `RuntimeFeatureConfig` line 90; `RuntimeFeatureSchema` line 56; labels lines 714-723; help lines 1953-1972 | `tests/unit/runtime-provider-tool-registry.test.ts:166` validates strict schema and absent defaults. |
| Runtime-core barrel exports canonical registry contracts. | file | `openclaw_runtime/src/runtime-core/index.ts`; `openclaw_runtime/src/runtime-core/registry.ts` | `index.ts` line 4; `registry.ts` line 1 | `index.ts` exports `./registries.js`; `registry.ts` re-exports the same file. |
| Focused registry tests pass. | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-provider-tool-registry.test.ts` | pass: 1 file / 6 tests | Covers Lane A contracts/flags/config/diagnostics. |
| Existing Phase-2 shadow/parity slice still passes with new registry tests. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-provider-tool-registry.test.ts` | pass: 5 files / 70 tests | Covers runtime-core, context shadow, MCP shadow, TaskLoop shadows, and registry contracts. |
| TypeScript node check passes. | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Used direct Node after the pnpm shim attempt failed. |
| Harness spec validates. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Phase-3 task spec structure valid. |
| Renderer boundary scan found no new lane violations. | command | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed | Matches are existing preload/Main/tests/rule text/URL helper cases; no lane-edited renderer file matched. |
| No second runtime service was added by Lane A files. | missing-after-search | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|18789' openclaw_runtime/src/runtime-core tests/unit/runtime-provider-tool-registry.test.ts` | no matches | Registry contracts/tests do not start services, ports, HTTP servers, WebSocket servers, or Gateway instances. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/runtime-core/registries.ts` defines registry contracts, manifest validation, diagnostics, empty-by-default registry classes, feature flag resolution, and error isolation.
- `openclaw_runtime/src/runtime-core/index.ts` exports the registry contracts through the runtime-core barrel.
- `openclaw_runtime/src/runtime-core/registry.ts` re-exports `registries.ts` to avoid duplicate same-purpose registry contract files.
- `openclaw_runtime/src/config/types.openclaw.ts` and `openclaw_runtime/src/config/zod-schema.ts` accept optional Phase-3 registry flags.
- `openclaw_runtime/src/config/schema.labels.ts` and `openclaw_runtime/src/config/schema.help.ts` document the internal flags as shadow/pilot-only.

Tests:

- `tests/unit/runtime-provider-tool-registry.test.ts` verifies default-off flags, manifest validation/rejection, deterministic registry ordering, duplicate diagnostics, config strictness, isolated runtime errors, and normalized provider outputs.
- Existing Phase-2 unit tests were run with the new registry test to prove context/MCP/task-loop shadow surfaces were not perturbed.

Feature flags:

- Added optional `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, `runtime.contextProviders.registryPilot`, and `runtime.toolRegistry.shadow` helpers/schema entries.
- Existing `runtime.contextProviders.shadow`, `runtime.contextProviders.loopPackShadow`, and `runtime.toolProtocol.mcpShadow` remain independent Phase-2 adapter flags; this lane does not change their behavior.

Harness/spec changes:

- No harness spec source was changed in this lane.
- Required Phase-3 harness `context` and `validate --no-diff` commands passed.

## Registry Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Registry flags | `RUNTIME_REGISTRY_FLAG_PATHS`, `DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS`, `resolveRuntimeRegistryFeatureFlags` | flag-off | `runtime.registryPilot.enabled`; `runtime.providerRegistry.shadow`; `runtime.contextProviders.registryPilot`; `runtime.toolRegistry.shadow` | `openclaw_runtime/src/runtime-core/registries.ts` lines 19, 30, 437; `tests/unit/runtime-provider-tool-registry.test.ts:61` |
| Context provider manifest | `RuntimeContextProviderManifest`, `RuntimeContextProvider`, `RuntimeContextProviderRegistry` | pilot/shadow contract only; no active providers registered | `runtime.contextProviders.registryPilot` | `openclaw_runtime/src/runtime-core/registries.ts` lines 122, 168, 499 |
| Tool provider manifest | `RuntimeToolProviderManifest`, `RuntimeToolProvider`, `ToolProviderRegistry` | pilot/shadow contract only; no MCP callTool cutover | `runtime.toolRegistry.shadow` | `openclaw_runtime/src/runtime-core/registries.ts` lines 128, 176, 542 |
| Diagnostics/fallback | `RuntimeRegistryDiagnostic`, `RuntimeRegistryDiagnosticReason`, `RuntimeRegistryIsolatedError` | diagnostics/evidence only | registry flags above | `openclaw_runtime/src/runtime-core/registries.ts` lines 62, 95, 188, 591 |
| Config schema/help | `RuntimeFeatureConfig`, `RuntimeFeatureSchema`, labels/help entries | optional config, default off | all registry flags above plus existing shadow families | `openclaw_runtime/src/config/types.openclaw.ts:90`; `openclaw_runtime/src/config/zod-schema.ts:56`; `tests/unit/runtime-provider-tool-registry.test.ts:166` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `openclaw_runtime/src/context-engine/legacy.ts` and `openclaw_runtime/src/agents/loop-context-pack.ts` | Legacy message/prompt output remains authoritative. | Combined Vitest command passed `tests/unit/context-shadow-adapter.test.ts`; no context adapter path was edited. | Low; future Lane B must avoid prompt/message cutover without parity tests. |
| `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` | Legacy `McpCallToolResult` response shape remains authoritative. | Combined Vitest command passed `tests/unit/mcp-api.test.ts`; no MCP adapter path was edited. | Low; future Lane C owns MCP registry adapter and must preserve response shape. |
| `openclaw_runtime/src/agents/task-loop-controller.ts` | Task-loop lifecycle/status/checkpoint behavior remains unchanged. | Combined Vitest command passed `tests/unit/task-loop-controller.test.ts`; no TaskLoop path was edited. | Low; future Lane D must attach only shadow evidence. |
| OpenClaw config parsing | Absent runtime registry flags produce no defaults and no behavior. | `tests/unit/runtime-provider-tool-registry.test.ts:61` and `:166`; direct TypeScript check passed. | Low; flags are optional and strict. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Required harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | pass | Required reading list before implementation | None |
| Focused registry unit test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-provider-tool-registry.test.ts` | pass, 1 file / 6 tests | Lane A contracts/flags/schema/registry diagnostics | None |
| Combined Phase-3 unit slice | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-provider-tool-registry.test.ts` | pass, 5 files / 70 tests | Runtime-core contracts, context shadow parity, MCP shadow parity, TaskLoop shadows, new registry contracts | None |
| Node TypeScript check | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Type-level compatibility for node/runtime surfaces touched here | None |
| pnpm typecheck shim attempt | `rtk pnpm run typecheck:node` | fail | Attempted standard script | Known local RTK/pnpm shim issue: `"node"` not recognized. Direct Node TypeScript command passed. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Phase-3 task spec structure | None |
| Renderer boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | pass/reviewed | No new renderer direct IPC/Gateway bypass in lane files | Existing matches remain in preload/Main/test/rule text and URL helper tests; no lane-edited renderer file matched. |
| Runtime service scan | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|18789' openclaw_runtime/src/runtime-core tests/unit/runtime-provider-tool-registry.test.ts` | pass/no matches | No second runtime service from Lane A files | None |
| Comms replay/compare | `pnpm run comms:replay`; `pnpm run comms:compare` | not-run | Gateway/runtime send/receive/delivery/fallback regression | Not required for this lane: no Main/Gateway communication path changed; only runtime-core contracts/config schema/tests were edited. |
| Electron E2E | targeted Playwright | not-run | User-visible UI behavior | Not required: no UI/user-visible behavior changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Added only TypeScript contracts/config/tests; runtime service scan over Lane A files had no server/port matches; no `verseshell-runtime` authority was added. |
| No renderer direct IPC | pass | Boundary scan reviewed; no `src/pages/**` or `src/components/**` edits and no lane file contains `window.electron.ipcRenderer.invoke`. |
| No renderer direct Gateway HTTP/WS | pass | Boundary scan reviewed; no renderer transport code changed or added. |
| Feature flags default safe | pass | `DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS` all false; config fields optional; `OpenClawSchema.parse({}).runtime` remains undefined in `tests/unit/runtime-provider-tool-registry.test.ts:178`. |
| Flag-off parity covered | pass | Existing Phase-2 context/MCP/task-loop tests passed in combined command with new registry tests. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| `ToolProviderRegistry` class name may be broader than future Lane C MCP-specific adapter needs. | `openclaw_runtime/src/runtime-core/registries.ts:542` only defines empty registry mechanics and does not wire MCP. | Lane C should wrap MCP `callTool` without changing legacy result shape. | Lane C should consume these contracts or record any adapter mismatch in its Handoff Notes; do not duplicate `ToolCallResult`. |
| `runtime.toolProtocol.mcpShadow` is represented in config schema but not in `RUNTIME_REGISTRY_FLAG_PATHS`. | Existing MCP shadow adapter already uses `runtime.toolProtocol.mcpShadow`; Lane A registry helper covers registry flags only. | Keep MCP protocol shadow independent from tool registry shadow. | Lane C can bridge diagnostics between `runtime.toolProtocol.mcpShadow` and `runtime.toolRegistry.shadow` without changing this helper, or propose a small helper extension. |
| Earlier parallel drafts introduced both `registry.ts` and `registries.ts`. | `openclaw_runtime/src/runtime-core/registry.ts:1` is now a re-export; `openclaw_runtime/src/runtime-core/index.ts:4` exports `registries.ts`. | One canonical registry contract implementation. | Keep `registries.ts` canonical; remove the alias later only if no future lane imports `registry.js`. |
| Repository has large pre-existing dirty/untracked state from other phases/lanes. | `rtk git status --short` shows many unrelated modified/untracked files. | Lane A should only claim its listed implementation/test/submission paths. | Synthesis should review only listed Lane A paths for acceptance; do not attribute unrelated workspace changes to this lane. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Lane B/C consume registry contracts with compatibility providers.
New code path: Context/MCP compatibility provider adapters built against openclaw_runtime/src/runtime-core/registries.ts.
Legacy path wrapped: LoopContextPack/LegacyContextEngine and electron/services/mcp-api.ts callTool remain authoritative.
Shadow / pilot boundary: Registry diagnostics only; prompt text, message arrays, MCP responses, approvals, and TaskLoop statuses unchanged.
Feature flag: runtime.contextProviders.registryPilot and runtime.toolRegistry.shadow, with existing runtime.contextProviders.shadow/runtime.toolProtocol.mcpShadow where applicable.
Tests: Add context-provider-registry and tool-provider-registry focused tests plus existing context-shadow-adapter/mcp-api parity tests.
Harness: Continue using harness/specs/tasks/phase-3-provider-tool-registry-pilot.md validate/context.
Rollback: Disable registry flags; remove adapter registration while keeping runtime-core contracts.
Done when: Unknown/failing providers produce fallback diagnostics and legacy outputs remain byte/shape equivalent under flag-off and shadow mode.
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `runtime.toolProtocol.mcpShadow` be considered a registry flag in future combined diagnostics? | It affects how Lane C reports MCP shadow evidence beside `runtime.toolRegistry.shadow`. | maintainer/agent | no |
| Should config help/labels for internal Phase-3 flags surface in any user-facing settings UI? | If surfaced, i18n/E2E/docs requirements expand. | maintainer/user | no |

## Handoff Notes

- This lane intentionally does not register or invoke active providers/tools; `RuntimeContextProviderRegistry` and `ToolProviderRegistry` are empty unless future lanes explicitly pass providers.
- Do not treat `verseshell-runtime` as a registry service; it remains a user-configured stdio terminal tool exception and was not touched.
- No renderer/Main transport path was changed; comms replay/compare and E2E are left to lanes that alter Main/Gateway or user-visible behavior.
- Future lanes should avoid adding a second `ToolCallRequest`/`ToolCallResult` shape; import from `openclaw_runtime/src/runtime-core` instead.
- `openclaw_runtime/src/runtime-core/registry.ts` is only a compatibility re-export for the canonical `registries.ts` implementation; synthesis can remove it if no lane needs that import path.
