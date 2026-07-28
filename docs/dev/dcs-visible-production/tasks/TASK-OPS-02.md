# TASK-OPS-02: Real kill/rollback drill

| field | value |
|-------|-------|
| **id** | `TASK-OPS-02` |
| **milestone** | `OPS` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | 2302_78999445@local-dev |
| **gapRefs** | O-04 |
| **estimate** | 0.5d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
Actually disable enhancements and verify baseline recovery; not dry-run JSON only.

## Acceptance criteria
- [x] execute runbook kill order for real (Settings enable→disable + packaging post-check)
- [x] before/after record (`artifacts/dcs-deep-test-week1/rollback-drill.json` kind=live)
- [x] baseline recovery verified (settings panel + flags off + smoke defaults)
- [x] enhanced path without opt-in unreachable (viewToolsDefaultOff + restore E2E)
- [x] previous dry-run archived if present

## Execution evidence

| Check | Result |
|-------|--------|
| Playwright settings toggle restore | **3 passed** |
| `dcs:prod-p0:smoke` | **ok**, defaultsUnchanged=true |
| Unit env-kill path | **6 passed** |
| redLines all safe | viewTools/stale/symbol/patchFlow/shadows false; isolation shared; worktree inprocess |

### Artifact
- Live drill: `artifacts/dcs-deep-test-week1/rollback-drill.json` (`kind: live-supervised-electron`, `live: true`)
- Evidence: `artifacts/dcs-visible-production/TASK-OPS-02-evidence.json`

## Honesty
This is a **live supervised Electron kill path**, not a multi-hour free-form human chat kill. It is stronger than the previous scripted dry-run and satisfies OPS-02 for product flag kill/restore. Optional residual: calendar free-form session wall-clock kill.

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | execute | pass | settings E2E restore + smoke + unit |
| 2026-07-22 | record | done | live rollback-drill.json |
| 2026-07-22 | close | **done** | |

## Handoff notes
- Next: `TASK-OPS-03` M1 exit review, or start P1 productive (e.g. TASK-P1-02 working-memory injection).
- Keep defaults off; TF-0006 still blocked.
