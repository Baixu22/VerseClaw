# OPS-03 Gate Decision — M0 exit / M1 entry

**date:** 2026-07-22  
**operator:** Claude (program review)  
**git baseline:** `60931957b` (verify HEAD before implement)

## Decision matrix

| Gate | Decision | Rationale |
|------|----------|-----------|
| **M0 honesty complete** | **YES** | P0-01..06 + M0-INTEGRATION PASS |
| **Enter M1-productive** | **GO** | Control plane usable; kill works; W5 green; ops continue |
| **M1 complete / exit** | **NO** | P1-01/P1-02 not done; working-memory still default-off unproven as “真干活” |
| **Enter M2 default-on track** | **NO-GO** | TF-0006 blocked; liveReady/productApproved false; canary keep-off |
| **Joint GA language** | **FORBIDDEN** | hardLocks |

## Main-path shelfware (summary)

| ID | Cleared? |
|----|----------|
| UI-01 DCS Flags writable | **Yes** |
| T-04 view tools discover+opt-in | **Yes (opt-in)** |
| M-01 working-memory injection | **No → M1** |
| CodeGraph / dead factViews / stale “unregistered” claims | **Yes (retired/stale-tagged)** |

## Recommended next tasks

1. `TASK-P1-02` working-memory injection  
2. `TASK-P1-04` VToken vs DCS path decision  
3. `TASK-P1-01` Fact view live A/B class  

## Forbidden next

- Flip DEFAULT_* or packaging defaults to prove usable  
- Mark TF-0006 unblocked without four evidence files  
- SEKB auto writeback  

## Evidence pointers

- `artifacts/dcs-visible-production/M0-INTEGRATION-REPORT.json`  
- `artifacts/dcs-visible-production/TASK-OPS-01-evidence.json`  
- `artifacts/dcs-visible-production/TASK-OPS-02-evidence.json`  
- `artifacts/dcs-deep-test-week1/ops-01-decision.md`  
- `artifacts/dcs-deep-test-week1/rollback-drill.json` (live:true)  
- Full writeup: `tasks/TASK-OPS-03.md`  
