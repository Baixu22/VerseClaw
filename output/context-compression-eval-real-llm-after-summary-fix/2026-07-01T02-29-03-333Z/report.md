# Context Compression Eval Report
- Run ID: 2026-07-01T02-29-03-333Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: daily
- Sample source: real
- Samples: 30
- Real/Synthetic: 30/0
- Evidence insufficient: no
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 30 samples
- LLM continuation: deepseek/deepseek-chat on 30 samples
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1845, density=6.4827 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=3.9333, min=0, accuracy=0.6333, actionability=0.3333 | FAIL |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=0.9667, critical=0.9667, noRepeat=1, delta=0.0333 | PASS |
## Cohorts
- Real samples: 30, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.60, 0.75, 0.85, 0.95, emergency
- Turn cohorts: 50, 200, 1000
## Worst Cases
- R1: missing=0, staleLeaks=0
- R2: missing=0, staleLeaks=0
- R3: missing=0, staleLeaks=0
- R4: missing=0, staleLeaks=0
- R5: missing=0, staleLeaks=0
- R6: missing=0, staleLeaks=0
- R8: missing=0, staleLeaks=0
- R9: missing=0, staleLeaks=0
- R10: missing=0, staleLeaks=0
- R11: missing=0, staleLeaks=0
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.