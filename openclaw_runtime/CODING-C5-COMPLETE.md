# CODING-C5-COMPLETE

**Date**: 2026-07-15
**Branch**: `codex/dcs-c5-lease-patchflow`
**Base**: `52fbd7289` (C4 worktree interface on main residual)
**Scope**: DCS Phase4 C5-1..C5-3 symbol lease + patch-flow + isolation matrix
**Completion class**: **`done (interface)`** — single-process lease interface + recommend API; **not** multi-process WAL production hard (C5-H)

## DEV delivered

| Card | Status | Deliverable |
|------|--------|-------------|
| C5-1 symbol lease | **done (interface)** | `factstore/symbol-lease.ts` acquire/release/expire; write-tool wrap `symbol-lease-guard.ts` |
| C5-2 patch-flow | **done (interface)** | `agents/patch-flow.ts` serial apply + verify; hard-destructive approval surface (C2-10) |
| C5-3 isolation matrix | **done** | `agents/isolation-mode-matrix.ts` recommend `shared` / `worktree` / `patch-flow` |
| C5-H WAL mode | **opt-in only** | `runtime.coding.symbolLease.mode=wal` exists; default `memory` |

## Explicit enable (defaults remain safe)

| Feature | Default | How to open |
|---------|---------|-------------|
| Symbol lease on write tools | **off** | `runtime.coding.symbolLease.enabled=true` (or tool option `symbolLeaseEnabled`) |
| Lease storage mode | **memory** | `runtime.coding.symbolLease.mode=memory\|wal` |
| Patch-flow orchestration default | **false** | Call `applyPatchProposalsSerial()` / use matrix recommend; do **not** set `runtime.coding.patchFlow.default=true` without C5-H evidence |
| Isolation production request | **shared** | C4 `isolation: "shared"\|"worktree"`; `patch-flow` is recommend-only, not a request default |

## TEST / ACCEPT

| Suite | Result |
|-------|--------|
| `symbol-lease.test.ts` | pass (4) |
| `symbol-lease-guard.test.ts` | pass |
| `patch-flow.test.ts` | pass |
| `isolation-mode-matrix.test.ts` | pass (5) |
| `scripts/coding-c5-acceptance.mts` | pass → `artifacts/coding-c5/acceptance.json` `ok:true` |

### Acceptance evidence fields

- `leaseHeld=true`
- `leaseConflictBlocked=true`
- `leaseExpireReacquire=true`
- `patchFlowSerialApply=true`
- `destructiveApprovalPath=true`
- `matrixRecommend.dense=patch-flow`
- `defaultStillShared=true`
- `completionClass=done (interface)`

## Gate table

| Gate | Command | Result |
|------|---------|--------|
| 1 test:dcs | unit + runtime-config + agents shards | **pass** (167 + 10 + 73) |
| 2 typecheck | `pnpm run typecheck` | **pre-existing fail** on `knowledge-api.ts` / host-api (untouched by C5; same as C4) |
| 3 lint:check (bom+eslint) | check-no-bom + eslint . | **pass** errors=0; warnings=111 |
| 3b lint:dcs full set | oxlint type-aware DCS set | pre-existing residual (C4); C5-touched oxlint `--deny-warnings` (non-type-aware) **exit 0** |
| 4 runtime build | `pnpm --dir openclaw_runtime build` | **pass** total ~394s |
| 5 directed vitest | lease/guard/patch/matrix | **pass** |
| 6 e2e | playwright dcs-production-wiring-w5 --workers=1 | **pass** 3/3 in 2.6m |
| 7 artifacts | `artifacts/coding-c5/*.json` | `ok: true` |

## Honesty / residual (C5-H)

- Multi-process WAL lease is **not** production-hardened; do not claim multi-process write mutual exclusion hard default.
- Isolation default remains **shared**; matrix recommend does **not** auto-switch production path.
- Patch-flow is opt-in lead serial apply; workers never write disk in this path.
- No external distributed lock service / new production npm deps.
- Drive-by gate hygiene (not C5 feature): stripped sekb helper BOMs; fixed knowledge-api irregular whitespace; simplified sekb `journaled` assignment so monorepo eslint hits errors=0.

## SHA

1ba5e9b4e957b9cc805b2581dfc2e3eb1ab2824c
