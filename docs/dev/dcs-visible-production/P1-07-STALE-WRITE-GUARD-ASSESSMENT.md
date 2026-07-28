# TASK-P1-07 staleWriteGuard assessment (production candidate)

| field | value |
|-------|-------|
| **date** | 2026-07-22 |
| **default** | **false** (do not flip) |
| **Settings** | `stale-write-guard` writable (P0-01) |

## Mechanism

- Wrap full-file `write` when `runtime.coding.staleWriteGuard.enabled=true`.
- Block if session has a prior read hash and on-disk content diverged.
- Never block unread paths (generators/external create).
- Metrics: `coding.write.staleBlocks`, `coding.write.falseBlockRate` (`staleBlocks / (staleBlocks + staleAllowances)`).

## Override UX (TASK-P1-07)

| Path | Behavior |
|------|----------|
| Re-read file then write | Normal allowance |
| `force=true` or `allowStaleWrite=true` on write args | Bypass block; count as **allowance** |
| Settings off | Guard not installed |

Error text explains: re-read **or** force/allowStaleWrite.

## Synthetic corpus (unit)

| Case | Expected | Covered |
|------|----------|---------|
| read → external change → write | block | yes |
| read → write same disk | allow | yes |
| unread write | allow | yes |
| flag off | allow | yes |
| stale + force | allow + allowance | yes (new) |
| message explains override | yes | yes (new) |

**falseBlockRate on pure unit corpus:** not a live editor-churn sample; rate is scenario-dependent. Live multi-session churn corpus remains residual before default-on discussion.

## Graduation readiness

| Gate | Status |
|------|--------|
| Safe opt-in via Settings | **yes** |
| Explainable block | **yes** |
| Override path | **yes** |
| Metrics counters | **yes** |
| Live false-block corpus &lt;1% | **not yet** → keep **default off** |
| productApproved | **false** |

## Recommendation

**keep-off** for product default. Safe for controlled opt-in canary. No default-on.
