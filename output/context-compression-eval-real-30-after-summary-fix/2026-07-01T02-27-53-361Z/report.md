# Context Compression Eval Report
- Run ID: 2026-07-01T02-27-53-361Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: daily
- Sample source: real
- Samples: 30
- Real/Synthetic: 30/0
- Evidence insufficient: no
- Semantic matching: disabled
- LLM judge: not executed
- LLM continuation: not executed
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1846, density=6.476 | FAIL |
| L2 Faithfulness | score=9.4, min=4, causal=1, actionability=0.9 | FAIL deterministic |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
## Cohorts
- Real samples: 30, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.60, 0.75, 0.85, 0.95, emergency
- Turn cohorts: 50, 200, 1000
## Worst Cases
- R1: missing=0, staleLeaks=1
- R3: missing=0, staleLeaks=1
- R5: missing=0, staleLeaks=1
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.