# TF-0510 coding control dispositions

- Task: `TF-0510` - give stale-write-guard, symbol-lease/WAL, patch-flow, worktree/isolation an explicit graduate-or-retire outcome
- Actor: `codex` | Evidence driver: `agent`
- **Completion verdict: `blocked-by-gaps`** - see "Remaining gaps" below
- Release boundary: no public release, GA, liveReady or productApproved claim

## What changed

| Area | Change |
|---|---|
| `openclaw_runtime/src/agents/coding-control-dispositions.ts` | New recomputable ledger covering all five components with current consumer, disposition, implementation state, implementing node, verification artifacts, product entry and remaining gap. |
| `openclaw_runtime/src/agents/patch-flow-graduation.ts` | The gate no longer hard-codes `meetsGate: false` / `recommendation: "keep-off"`; it can now report a real outcome. It still never flips the runtime default. |
| `openclaw_runtime/src/agents/patch-flow-graduation.test.ts` | The old "always keep-off even with soak" expectation is replaced by a reachable-outcome test plus a defaults-unchanged test. |
| `tests/unit/coding-controls-tf0510.test.ts` | Guards the ledger shape, artifact existence, the no-substitution rule and the control-plane boundary. |
| `tests/unit/fixtures/coding-controls-tf0510/generate-acceptance.mts` | Rehashes every declared artifact and writes `raw-evidence.json` with an explicit verdict. |

## Per-component outcome

| Component | Disposition | State | Remaining gap |
|---|---|---|---|
| stale-write-guard | advanced | implemented-opt-in | none |
| symbol-lease | experiment | implemented-opt-in | 2 (see below) |
| patch-flow | experiment | implemented-opt-in | 3 (see below) |
| worktree-backend | advanced | implemented-opt-in | none |
| isolation-request | advanced | implemented-opt-in | none |

## Remaining gaps (why this node is NOT closed)

`symbol-lease`:

1. Graduation is undefined by evidence - its own `graduateOrRetireCriteria` requires multi-writer
   benchmarks showing lower conflict/rework with reliable rollback, and no such benchmark exists.
   Correctness is proven (7 WAL tests incl. concurrent single-winner and crash reclaim); the *benefit*
   claim is not.
2. The owning record cannot be updated from here: `feature.symbol-lease` is `experiment` with a
   2026-12-31 expiry in `shared/dcs/component-disposition-catalog.ts`, and `shared/` is outside the
   TF-0510 write scope.

`patch-flow`:

1. Graduation is undefined by evidence - its criteria require patch execution to improve verified
   coding outcomes while preserving write-journal authority, and no outcome comparison exists.
2. Its only entries are the model tool parameter `patchFlowExecution=true` and an operator config flag;
   no natural task action or explicit concurrent workflow selects it.
3. The owning record cannot be updated from here (same `shared/` scope boundary as above).

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| Every coding control component has completion or verified retirement with a recomputable artifact | **partial** | 3 of 5 complete with empty gap; 2 carry recorded gaps - `raw-evidence.json` |
| On close, every component has an empty remainingGap | **not met** | `summary.componentsWithGaps = [symbol-lease, patch-flow]` |
| If follow-up implementation nodes are generated, coding-change-safety and final review depend on them; if implemented here, every component reports all-pass | **n/a (no follow-up node generated)** | this node implemented the in-scope parts instead |
| patch-flow has a reachable default/advanced product entry, or is retired; no permanent API-only exit | **pass** | the hard-coded keep-off gate is removed; `patchFlowExecution` is a model tool parameter; the runtime default stays false |
| Concurrency, conflict, crash recovery, cleanup and shared-interface compatibility negative tests pass | **pass** | `03-stale-and-lease.txt`, `04-worktree-isolation.txt`, `05-root-worktree-wal.txt` |

## Gates

See `verification.json`: ledger guard, patch-flow, stale/lease, worktree/isolation, root worktree+WAL,
typecheck, lint, contract, no-BOM, diff check, regenerate-evidence, scope audit, checksum check.

## Unverified boundary

- This node is **not** a completed closeout: two of five components still carry gaps, so it must stay
  open. Classification, ownership and the 2026-12-31 expiry are explicitly NOT used as completion.
- No multi-writer benchmark and no coding-outcome comparison exist, so neither experiment can be
  graduated on benefit evidence; retiring them would also require editing `shared/dcs/**`.
- Agent-driven only; no human evidence is claimed.
