# lane-a-collector-contracts-and-flags: Runtime registry diagnostic collector contract and default-off flags

## Scope Confirmation

- Lane: lane-a-collector-contracts-and-flags
- Output file: runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-a-collector-contracts-and-flags.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/runtime-core/registries.ts; openclaw_runtime/src/config/types.openclaw.ts; openclaw_runtime/src/config/zod-schema.ts; openclaw_runtime/src/config/schema.labels.ts; openclaw_runtime/src/config/schema.help.ts
- Test paths touched: tests/unit/runtime-provider-tool-registry.test.ts
- Commands run: pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts; pnpm --config.verify-deps-before-run=false run typecheck
- Required reading completed: yes

## Executive Summary

- Added `runtime.registryDiagnostics.collector` to runtime registry feature flag resolution with default false by omission.
- Added `collectRuntimeRegistryDiagnostics()` as the runtime-owned bounded collector helper.
- Collector output is caller-owned/in-memory only and includes schema version, bounded diagnostics, omitted count, deduped evidence refs, and summary counts.
- Expanded diagnostic status/reason vocabulary for waiting, cancelled, unsupported content, provider exceptions, and normalized tool error categories.
- Added strict config schema/type/help/label entries for the collector flag without enabling it by default.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Collector flag defaults off | file | openclaw_runtime/src/runtime-core/registries.ts | `DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS` | Omitted config resolves collector false. |
| Collector output is bounded | file | openclaw_runtime/src/runtime-core/registries.ts | `collectRuntimeRegistryDiagnostics` | Limit clamps and reports omitted count. |
| Config accepts explicit flag only | test | tests/unit/runtime-provider-tool-registry.test.ts | strict config test | Parses `runtime.registryDiagnostics.collector`. |
| Focused registry tests pass | command | pnpm --config.verify-deps-before-run=false exec vitest run ... | 5 files / 100 tests | Includes runtime collector tests. |

## Collector Surface

| Surface | Contract / Adapter | Shadow Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Runtime collector | `RuntimeRegistryDiagnosticCollectorInput` / `Output` | diagnostics-only, bounded, caller-owned | `runtime.registryDiagnostics.collector` | runtime-provider-tool-registry tests |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| Config omission | No runtime registry flags enabled | unit tests and typecheck | Low |
| Runtime registries | No providers registered by default | existing registry tests still pass | Low |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Focused unit slice | pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts | pass | Collector contract and flag behavior | None |
| Typecheck | pnpm --config.verify-deps-before-run=false run typecheck | pass | TS config/schema/runtime types | None |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No provider ordering/default registration cutover | pass | No default providers added; flag default false |
| No tool response/approval semantic drift | pass | Lane A touches contracts/config only |
| No TaskLoop authority drift | pass | Lane A does not affect TaskLoop decisions |
| No renderer direct IPC/Gateway bypass | pass | No renderer files touched |
| No second runtime service/listener | pass | No service code added |
| Comms replay/compare handled if required | not-run | Lane A alone does not touch comms paths |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Strict config path was not in the initial likely file list | Feature flag requires schema parity | Keep config schema/type/help/label aligned | Accepted as part of flag evidence |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: collector integration beyond shadow injection
New code path: none yet
Legacy path wrapped: existing context/tool diagnostic emitters
Shadow boundary: collector output remains metadata/evidence only
Feature flag: runtime.registryDiagnostics.collector
Tests: focused registry and TaskLoop shadow tests
Harness: rerun with clean diff
Rollback: omit collector flag
Done when: clean-worktree harness validate passes without --no-diff
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should collector flag become a master gate for all future registry diagnostics? | Avoids flag sprawl | maintainer | no |

## Handoff Notes

`harness validate` without `--no-diff` is blocked by unrelated dirty files in this workspace; structural validation with `--no-diff` passes.
