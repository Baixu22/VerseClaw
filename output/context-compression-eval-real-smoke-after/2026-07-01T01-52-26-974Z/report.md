# Context Compression Eval Report
- Run ID: 2026-07-01T01-52-26-974Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: daily
- Sample source: real
- Samples: 6
- Real/Synthetic: 6/0
- Evidence insufficient: no
- Semantic matching: disabled
- LLM judge: not executed
- LLM continuation: not executed
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=0.4545, stale=0.75 | FAIL |
| L1 Fidelity | wRecall=1, compression=0.0359, density=40.1389 | FAIL |
| L2 Faithfulness | score=9, min=4, causal=1, actionability=0.8333 | FAIL deterministic |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
## Cohorts
- Real samples: 6, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.60
- Turn cohorts: 50
## Worst Cases
- R3: missing=0, staleLeaks=1
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.