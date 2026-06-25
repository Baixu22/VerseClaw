# lane-d-context-shadow-adapter: ContextItem Shadow Adapter

## Scope Confirmation

- Lane: `lane-d-context-shadow-adapter`
- Output file: `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-d-context-shadow-adapter.md`
- Lane-owned file only: yes
- Files/directories searched: `openclaw_runtime/src/context-engine`, `openclaw_runtime/src/agents/loop-context-pack.ts`, `tests/unit/context-shadow-adapter.test.ts`, `tests/unit/loop-context-pack.test.ts`
- Commands run:
  - `rtk rg -n "ContextItem|contextProviders|loopPackShadow|buildLoopContextItems|contextProviderShadowFlagEnabled" openclaw_runtime/src/context-engine openclaw_runtime/src/agents/loop-context-pack.ts tests/unit/context-shadow-adapter.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts`
- Prior handoffs reviewed: misplaced `runtime-research/handoffs/lane-d-context-shadow-adapter.blocked.md`, Phase-1 synthesis, Phase-2 synthesis

## Executive Summary

- This file supersedes the old misplaced blocked handoff at `runtime-research/handoffs/lane-d-context-shadow-adapter.blocked.md`.
- Lane A contracts now exist, so context shadow adapters can import canonical `ContextItem`.
- `LoopContextPack` can emit optional `ContextItem[]` shadows behind `runtime.contextProviders.shadow` or `runtime.contextProviders.loopPackShadow`.
- `LegacyContextEngine.assemble()` can emit optional message `ContextItem[]` shadows behind `runtime.contextProviders.shadow`.
- Prompt text and model message arrays remain legacy-authoritative; shadow items are side-channel only.
- Tests cover flag-off deep equality, prompt text parity, and message identity/order preservation.
- This lane does not implement AgentMap ranking or provider ordering cutover.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Context engine result type has optional shadow-only `contextItems`. | file | `openclaw_runtime/src/context-engine/types.ts` | `AssembleResult`, lines 8-14 | Comment says callers must not add these to prompts. |
| Shadow flags are defined under runtime context providers. | file | `openclaw_runtime/src/context-engine/shadow-flags.ts` | lines 1-28 | Supports `shadow` and `loopPackShadow`. |
| LegacyContextEngine imports canonical `ContextItem`. | file | `openclaw_runtime/src/context-engine/legacy.ts` | import line 4 | Uses `../runtime-core/types.js`. |
| LegacyContextEngine message shadows are built separately from messages. | file | `openclaw_runtime/src/context-engine/legacy.ts` | `buildLegacyContextItems`, lines 52-76 | Converts messages to `ContextItem[]`. |
| LegacyContextEngine assemble returns messages unchanged and adds shadows only with flag. | file | `openclaw_runtime/src/context-engine/legacy.ts` | `assemble`, lines 105-123 | `messages: params.messages`, optional `contextItems`. |
| LoopContextPack imports canonical `ContextItem`. | file | `openclaw_runtime/src/agents/loop-context-pack.ts` | import line 2 | Uses runtime-core type. |
| LoopContextPack has optional `contextItems` side-channel. | file | `openclaw_runtime/src/agents/loop-context-pack.ts` | `LoopContextPack`, lines 100-113 | Optional field not used by formatter. |
| Loop context items map to canonical `ContextItem`. | file | `openclaw_runtime/src/agents/loop-context-pack.ts` | `loopContextItemToContextItem`, lines 353-383 | Carries source kind, token estimate, truncation, omitted metadata. |
| LoopContextPack shadows are flag-gated. | file | `openclaw_runtime/src/agents/loop-context-pack.ts` | lines 459-463 | Adds `contextItems` only when shadow flag enabled. |
| Flag-off LoopContextPack parity test exists. | test | `tests/unit/context-shadow-adapter.test.ts` | lines 10-25 | Deep equality and no `contextItems`. |
| LoopContextPack prompt parity test exists. | test | `tests/unit/context-shadow-adapter.test.ts` | lines 28-66 | Formatter output unchanged with shadows. |
| LegacyContextEngine message parity test exists. | test | `tests/unit/context-shadow-adapter.test.ts` | lines 68-99 | Messages identity preserved; shadow validates as `ContextItem`. |
| Focused runtime foundation run passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 3 files / 52 tests | Includes context shadow adapter tests. |
| Prior misplaced handoff is superseded. | handoff | `runtime-research/handoffs/lane-d-context-shadow-adapter.blocked.md` | status `blocked_on_lane_a_contracts` | No longer canonical after this submission. |

## Current State

Current code:

- `ContextEngine.AssembleResult` includes optional `contextItems` documented as shadow-only.
- `LegacyContextEngine` remains pass-through for messages and only adds shadows when enabled.
- `LoopContextPack` remains the prompt-affecting bounded context pack; shadow `ContextItem[]` are not consumed by the formatter.

Current tests:

- `tests/unit/context-shadow-adapter.test.ts` covers flag-off, flag-on, prompt parity, and message preservation.
- `tests/unit/loop-context-pack.test.ts` covers existing LoopContextPack behavior.

Current harness specs:

- Runtime contract layer spec exists. A dedicated provider registry cutover spec remains future work.

Existing handoff notes:

- The old lane-d file was blocked before contracts landed. It is superseded by this current evidence.

## Shadow Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| LoopContextPack | Pack items -> runtime-core `ContextItem[]` | shadow-only | `runtime.contextProviders.loopPackShadow` or `runtime.contextProviders.shadow` | `loop-context-pack.ts:353`-`:390`, `:459`-`:463` |
| LegacyContextEngine | Agent messages -> runtime-core `ContextItem[]` | shadow-only | `runtime.contextProviders.shadow` | `legacy.ts:52`-`:76`, `:120`-`:122` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `formatLoopContextPackForPrompt()` | Prompt text remains unchanged by shadow items. | `tests/unit/context-shadow-adapter.test.ts:43`. | Future formatter changes must ignore `contextItems`. |
| `buildLoopContextPack()` flag off | Exact pack shape equals baseline. | `tests/unit/context-shadow-adapter.test.ts:18`-`:25`. | Hash calculations must remain independent of shadow field. |
| `LegacyContextEngine.assemble()` | Returns original `messages` array. | `legacy.ts:117`-`:123`; test lines 84-86. | Future provider cutover must not add prompt text during shadow mode. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Context shadow adapter tests | `tests/unit/context-shadow-adapter.test.ts` | pass in focused run | LoopContextPack and LegacyContextEngine shadow parity. | Does not cover AgentMap ranking. |
| LoopContextPack legacy tests | `tests/unit/loop-context-pack.test.ts` | existing file | Legacy prompt pack behavior. | Not rerun in the focused command above. |
| Focused runtime foundation run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | pass | Context shadow plus adjacent contracts/taskloop. | Does not prove provider registry cutover. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Context shadow is not full provider registry. | Current code only adds `ContextItem[]` side-channel. | Stage 4 provider registry cutover is later. | Keep this lane shadow-only; defer provider ordering to Phase 3/4 spec. |
| `ContextItem.source` labels are compatibility source strings. | `loopContextItemToContextItem` uses legacy section/source metadata. | Future provider ids should be canonical and registered. | Preserve metadata now; normalize provider ids during registry cutover. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Context shadow parity expansion
New code path: no new path; extend existing context shadow tests
Legacy path wrapped: LoopContextPack and LegacyContextEngine assemble
Shadow / warning boundary: shadow-only ContextItem[] side-channel
Feature flag: runtime.contextProviders.shadow and runtime.contextProviders.loopPackShadow
Tests: add TaskLoopContextPack reviewer formatter parity if not already covered
Harness: future runtime-provider-tool-adapter-shadow task spec
Rollback: disable context provider shadow flags
Done when: all context shadows are side-channel only and prompt/message parity is covered
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `shadow` and `loopPackShadow` be collapsed into one flag? | Avoid confusing provider flag taxonomy. | maintainer | no |
| What provider id namespace should replace legacy source strings? | Needed before provider registry cutover. | maintainer | no for Phase 2 |

## Handoff Notes

- This lane does not implement AgentMap ranking, SymbolProvider, provider ordering, or prompt ownership migration.
- Shadow `contextItems` must remain unavailable to prompt formatters unless a later accepted cutover explicitly changes behavior.
