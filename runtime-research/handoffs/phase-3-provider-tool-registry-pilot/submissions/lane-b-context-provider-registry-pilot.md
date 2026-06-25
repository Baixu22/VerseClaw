# lane-b-context-provider-registry-pilot: Context provider registry over LoopContextPack and LegacyContextEngine

## Scope Confirmation

- Lane: `lane-b-context-provider-registry-pilot`
- Output file: `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-b-context-provider-registry-pilot.md`
- Lane-owned file only: yes — this lane only added a context-engine pilot adapter, a focused unit test, and this submission file.
- Implementation paths touched: `openclaw_runtime/src/context-engine/provider-registry.ts`
- Test paths touched: `tests/unit/context-provider-registry.test.ts`
- Commands run: `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`; `rtk node node_modules/vitest/vitest.mjs run tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts`; `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts`; `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff`; boundary scans listed below.
- Required reading completed: yes — Phase 3 required docs and harness context were reviewed in this implementation window; scoped runtime `AGENTS.md` had already been read for runtime subtree policy.

## Executive Summary

- Added explicit compatibility context providers for `LegacyContextEngine` and `LoopContextPack` in `openclaw_runtime/src/context-engine/provider-registry.ts`.
- The providers use Lane A `RuntimeContextProviderRegistry` / manifest contracts and remain explicit-only; they are not registered into any live runtime path by default.
- Added a gated `runContextProviderRegistryPilot` helper that runs only when `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, and `runtime.contextProviders.registryPilot` are all true.
- Flag-off mode returns only a `flag_disabled` diagnostic and no provider results/context items.
- Flag-on shadow mode emits provider diagnostics, `ContextItem[]` evidence, and legacy-authoritative fallback metadata.
- `LegacyContextEngine` provider calls assemble with shadow enabled and records `messagesIdentityPreserved` / `messageOrderPreserved` diagnostics; it does not mutate messages.
- `LoopContextPack` provider compares baseline and shadow prompts/hashes and records `promptTextUnchanged` / `packHashUnchanged` diagnostics.
- No AgentMap ranking, provider ordering cutover, renderer IPC, Gateway HTTP/WS, UI, or second runtime service was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Harness context was run for the Phase 3 task spec. | command | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | output read order includes task/scenario/rules/layers | Pass. |
| Legacy and LoopContextPack provider ids are explicit constants. | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | `LEGACY_CONTEXT_ENGINE_PROVIDER_ID` / `LOOP_CONTEXT_PACK_PROVIDER_ID` lines 18-19 | Prevents hidden provider creation/cutover. |
| `LegacyContextEngine` is wrapped as a compatibility context provider. | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | `createLegacyContextEngineProvider` starts line 113; `messagesIdentityPreserved` diagnostic line 160 | Emits `ContextItem[]` from legacy assemble shadow data while preserving message identity/order. |
| `LoopContextPack` is wrapped as a compatibility context provider. | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | `createLoopContextPackProvider` starts line 183; `promptTextUnchanged` diagnostic line 231 | Builds baseline + shadow packs and compares prompt/hash before returning shadow context. |
| Registry pilot is explicit and not live/default-on. | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | `createContextProviderRegistryPilot` starts line 252; `runContextProviderRegistryPilot` starts line 259; `flag_disabled` diagnostic line 277 | Helper creates registry only when called; flag gate requires all three context pilot flags. |
| Provider diagnostics and fallback metadata are emitted. | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | `diagnostic` helper lines 62-82; legacy fallback metadata lines 151-166; loop fallback metadata lines 222-236 | Metadata includes `legacyAuthoritative`, `shadowOnly`, prompt/message parity facts. |
| Flag-off mode does not change legacy messages or prompt text. | test | `tests/unit/context-provider-registry.test.ts` | test starts line 51 | Asserts disabled result has no provider results/context items and baseline prompt remains unchanged. |
| Flag-on shadow mode emits context items without changing prompt text or message order. | test | `tests/unit/context-provider-registry.test.ts` | test starts line 90 | Asserts legacy + loop context items, diagnostics, message order, and prompt parity. |
| Standalone providers satisfy registry manifest/result validators. | test | `tests/unit/context-provider-registry.test.ts` | tests start lines 30 and 156 | Validates manifests and provider results through runtime-core validators. |
| Existing Phase-2 context shadow parity still passes. | test | `tests/unit/context-shadow-adapter.test.ts` | tests start lines 10, 28, 68 | Existing LoopContextPack/LegacyContextEngine shadow tests unchanged and passing. |
| User-requested Lane B focused tests pass. | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts` | output: 2 files / 7 tests passed | Pass. |
| Registry/core focused slice passes. | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts` | output: 3 files / 13 tests passed | Confirms Lane B works with Lane A contracts. |
| Harness task spec remains valid. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | output: `Spec is valid` | Pass. |
| No renderer direct IPC/Gateway bypass was added. | command | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` | exit 1, no stdout | No matches means pass. |
| No second runtime service/Gateway transport was added in Lane B touched files. | command | `rtk rg -n 'createServer|listen\(|new WebSocket|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/context-provider-registry.test.ts` | exit 1, no stdout | No matches means pass. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/context-engine/provider-registry.ts` adds `createLegacyContextEngineProvider`, `createLoopContextPackProvider`, `createContextProviderRegistryPilot`, and `runContextProviderRegistryPilot`.
- `createLegacyContextEngineProvider` wraps `LegacyContextEngine.assemble` with context shadow enabled, returns only normalized shadow context and diagnostics, and records identity/order preservation facts.
- `createLoopContextPackProvider` builds a baseline pack and a shadow pack, compares `formatLoopContextPackForPrompt` output and pack hash, then returns shadow `ContextItem[]` plus diagnostics.
- `runContextProviderRegistryPilot` requires all three flags before running providers: `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, and `runtime.contextProviders.registryPilot`.

Tests:

- `tests/unit/context-provider-registry.test.ts` covers explicit registration/manifests, flag-off disabled behavior, flag-on context-item/diagnostic output, prompt text stability, message order stability, and standalone provider wrappers.
- Existing `tests/unit/context-shadow-adapter.test.ts` remains unchanged and confirms Phase-2 LoopContextPack/LegacyContextEngine shadow behavior.

Feature flags:

- Flag-off: no providers are executed, no context items are emitted, and a `flag_disabled` diagnostic is returned.
- Flag-on shadow: providers emit diagnostics/context evidence only; no prompt/message output is consumed by live runtime paths.

Harness/spec changes:

- No harness spec changes were needed; `phase-3-provider-tool-registry-pilot` validated with `--no-diff`.

## Registry Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| LegacyContextEngine compatibility provider | `createLegacyContextEngineProvider(): RuntimeContextProvider` | shadow-only; returns normalized `ContextItem[]` and diagnostics, not prompt messages | `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot` when run through pilot helper | `openclaw_runtime/src/context-engine/provider-registry.ts:113`; `tests/unit/context-provider-registry.test.ts:90` |
| LoopContextPack compatibility provider | `createLoopContextPackProvider(): RuntimeContextProvider` | shadow-only; compares baseline/shadow prompt and hash before returning context items | same as above | `openclaw_runtime/src/context-engine/provider-registry.ts:183`; `tests/unit/context-provider-registry.test.ts:90` |
| Context registry pilot | `createContextProviderRegistryPilot(): RuntimeContextProviderRegistry` | explicit factory only; no active/default registration | none by itself; pilot runner is flag-gated | `openclaw_runtime/src/context-engine/provider-registry.ts:252`; `tests/unit/context-provider-registry.test.ts:30` |
| Flag-gated runner | `runContextProviderRegistryPilot(params)` | flag-off returns skipped diagnostic; flag-on returns provider shadow results | `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, `runtime.contextProviders.registryPilot` | `openclaw_runtime/src/context-engine/provider-registry.ts:259`; `tests/unit/context-provider-registry.test.ts:51` |
| Provider diagnostics/fallback | `RuntimeRegistryDiagnostic` with `legacyAuthoritative`, `shadowOnly`, prompt/message parity metadata | diagnostics only; does not fail task/prompt flow | registry pilot flags only | `openclaw_runtime/src/context-engine/provider-registry.ts:62-82`, `151-166`, `222-236` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `openclaw_runtime/src/context-engine/legacy.ts:LegacyContextEngine.assemble` | Returns the same `messages` array and only adds `contextItems` when existing shadow flag is on. | Existing `tests/unit/context-shadow-adapter.test.ts:68` passes; new provider test asserts `messagesIdentityPreserved` and `messageOrderPreserved`. | Low; this lane does not alter `legacy.ts`. |
| `openclaw_runtime/src/agents/loop-context-pack.ts:buildLoopContextPack` / `formatLoopContextPackForPrompt` | Prompt text remains derived from existing pack sections; `contextItems` are shadow-only. | Existing `tests/unit/context-shadow-adapter.test.ts:10` and `:28` pass; new provider test asserts `promptTextUnchanged` and baseline prompt equality. | Low; this lane does not alter `loop-context-pack.ts`. |
| Runtime prompt assembly / task loop | No live caller was changed to consume provider registry output. | Implementation is a new explicit helper file only; touched-file service scan has no server/WS/Gateway matches. | Low; later lanes must keep any integration shadow-only. |
| Renderer/Main boundary | No renderer/Main API was added. | Focused `src/pages src/components` boundary scan returned no matches. | Low. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | pass | Required Phase-3 task context and rules | None |
| User-requested focused tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts` | pass | Existing shadow parity plus Lane B registry provider pilot | None |
| Registry/core focused slice | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts` | pass | Lane A registry contracts + Lane B provider wrappers | None |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Task spec structural validity | None |
| Renderer focused boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` | pass | No renderer direct IPC/Gateway additions | Exit 1 means no matches. |
| No second service in touched files | `rtk rg -n 'createServer|listen\(|new WebSocket|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/context-provider-registry.test.ts` | pass | No second runtime service or Gateway endpoint in Lane B code | Exit 1 means no matches. |
| Comms replay/compare | `pnpm run comms:replay`; `pnpm run comms:compare` | not-run | Gateway/runtime send/receive regression | Not required: Lane B did not change Main/Gateway communication paths or fallback behavior. |
| E2E | targeted Electron E2E | not-run | User-visible UI behavior | Not required: no UI behavior changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Touched-file scan for `createServer`, `listen`, `new WebSocket`, and Gateway endpoints returned no matches. |
| No renderer direct IPC | pass | Focused scan of `src/pages` and `src/components` returned no matches. |
| No renderer direct Gateway HTTP/WS | pass | Same focused scan returned no Gateway endpoint matches. |
| Feature flags default safe | pass | `runContextProviderRegistryPilot` returns disabled unless all three pilot/shadow flags are true; flag-off test passes. |
| Flag-off parity covered | pass | `tests/unit/context-provider-registry.test.ts:51` and existing `context-shadow-adapter` flag-off test prove no prompt/message changes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Lane B requires all three context registry flags to run providers. | `runContextProviderRegistryPilot` gate requires `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, and `runtime.contextProviders.registryPilot`. | Later phases may choose master-gate semantics differently. | Synthesis should decide whether all three remain required or whether `runtime.contextProviders.registryPilot` alone is enough. Until then, strict gating is safest. |
| Provider wrappers live in `context-engine` but import `LoopContextPack` from `agents`. | `openclaw_runtime/src/context-engine/provider-registry.ts` imports `../agents/loop-context-pack.js`. | Long-term runtime-core provider registry may prefer adapters closer to each legacy owner. | Accept for pilot because it is explicit-only; later integration can move LoopContextPack provider beside the agent module if ownership prefers. |
| `runContextProviderRegistryPilot` returns diagnostics/results but is not wired into `LegacyContextEngine` / `LoopContextPack` call sites. | No existing runtime caller was changed. | Lane D or synthesis may want TaskLoop shadow evidence attachment. | Keep this lane accepted as adapter-only; integration lanes should import the helper only behind flags and parity tests. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Lane C or Lane D integration using existing registry diagnostics as shadow evidence
New code path: electron/services MCP tool provider adapter or TaskLoop registry shadow diagnostic sink
Legacy path wrapped: MCP callTool or TaskLoop shadow event projection
Shadow / pilot boundary: diagnostics/evidence only; legacy tool response/status remains authoritative
Feature flag: runtime.toolRegistry.shadow for tools; runtime.registryPilot.enabled + runtime.providerRegistry.shadow + runtime.contextProviders.registryPilot for context diagnostics
Tests: focused MCP/TaskLoop parity tests plus runtime-provider-tool-registry/context-provider-registry tests
Harness: rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff
Rollback: disable registry pilot/shadow flags; remove explicit helper call without touching legacy flows
Done when: registry diagnostics can be emitted as shadow evidence while prompt/messages/tool/status outputs remain byte/identity/order equivalent
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should context registry pilot require all three flags or only `runtime.contextProviders.registryPilot`? | Determines operator ergonomics and later lane integration gates. | synthesis owner/maintainer | no |
| Should LoopContextPack provider move under `openclaw_runtime/src/agents/` before default-on registry work? | Avoids context-engine importing agent-layer code long term. | maintainer/synthesis owner | no |
| Should provider diagnostics eventually attach to TaskLoop `RuntimeTaskEvent` shadows? | Needed for Lane D evidence, but must not affect final status. | Lane D/synthesis owner | no |

## Handoff Notes

- This lane intentionally does not implement AgentMap ranking or provider ordering cutover.
- The compatibility providers are explicit factories; no live runtime path imports or calls them unless a later lane adds a flag-gated shadow integration.
- `LegacyContextEngine` and `LoopContextPack` source files were not modified, reducing cross-lane conflict risk.
- The runner returns no provider context when flags are off, preserving old behavior and making rollback a flag disable/removal of explicit helper calls.
- `verseshell-runtime` remains untouched and is not treated as a provider registry service.
