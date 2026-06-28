# lane-b-context-provider-diagnostics-collector: Collect context provider registry diagnostics without provider ordering cutover

## Scope Confirmation

- Lane: lane-b-context-provider-diagnostics-collector
- Output file: runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-b-context-provider-diagnostics-collector.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/context-engine/provider-registry.ts unchanged; collector consumed existing diagnostics from this seam
- Test paths touched: tests/unit/context-provider-registry.test.ts
- Commands run: focused unit slice; typecheck
- Required reading completed: yes

## Executive Summary

- Reused accepted `runContextProviderRegistryPilot()` diagnostics as collector input.
- Added context test coverage proving collector disabled output is empty and enabled output mirrors bounded context diagnostics.
- Preserved legacy provider ordering, message identity, prompt text, and explicit-provider execution gates.
- Unknown/provider-exception coverage remains through existing explicit extra-provider tests.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Context diagnostics feed collector only explicitly | test | tests/unit/context-provider-registry.test.ts | collector test | Disabled collector omits diagnostics. |
| Provider failures remain isolated | test | tests/unit/context-provider-registry.test.ts | provider failure tests | Legacy providers still succeed. |
| Prompt/message parity preserved | test | tests/unit/context-provider-registry.test.ts | prompt/message tests | Existing tests still pass. |

## Collector Surface

| Surface | Contract / Adapter | Shadow Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Context provider diagnostics | `runContextProviderRegistryPilot().diagnostics` -> collector helper | no prompt/message authority | `runtime.registryDiagnostics.collector` via explicit helper input | context-provider-registry tests |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| LegacyContextEngine | Messages remain authoritative | existing message identity/order tests | Low |
| LoopContextPack | Prompt/hash unchanged | existing prompt/hash tests | Low |
| Extra providers | Explicit only, failures isolated | existing explicit provider tests | Low |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Context provider registry tests | focused unit slice | pass | Context collector input and parity | None |
| Harness context | pnpm --config.verify-deps-before-run=false harness context --spec ... | pass | Required context selection | None |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No provider ordering/default registration cutover | pass | No context provider registration default changed |
| No tool response/approval semantic drift | pass | Not a tool lane |
| No TaskLoop authority drift | pass | Collector output not injected here |
| No renderer direct IPC/Gateway bypass | pass | No renderer files touched |
| No second runtime service/listener | pass | No service added |
| Comms replay/compare handled if required | not-run | Context-only lane does not touch Main/Gateway comms |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Context pilot still has separate surface flags | Existing accepted Phase 3 gate | Collector is an additional explicit consumer gate | Keep both; do not collapse in this slice |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: clean-worktree harness proof
New code path: none
Legacy path wrapped: context provider diagnostics
Shadow boundary: diagnostics only
Feature flag: runtime.registryDiagnostics.collector
Tests: context-provider-registry
Harness: validate without --no-diff on a clean task diff
Rollback: omit collector flag
Done when: no unrelated dirty files block diff validation
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should unknown-provider diagnostics get a dedicated collector fixture? | Existing invalid/exception coverage is broad but not named unknown-provider collector output | maintainer | no |

## Handoff Notes

No context provider code change was needed; the accepted safe seam already emitted diagnostics suitable for the runtime-owned collector.
