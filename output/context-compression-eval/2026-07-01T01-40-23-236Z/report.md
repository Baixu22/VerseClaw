# Context Compression Eval Report
- Run ID: 2026-07-01T01-40-23-236Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: daily
- Sample source: hybrid
- Samples: 30
- Real/Synthetic: 0/30
- Evidence insufficient: yes
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 30 samples
- LLM continuation: deepseek/deepseek-chat on 30 samples
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1659, density=6.0338 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=1.4333, min=1, accuracy=1, actionability=1 | FAIL |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=1, critical=1, noRepeat=1, delta=0 | PASS |
## Cohorts
- Real samples: 0, L1 weighted recall: 1
- Synthetic samples: 30, L1 weighted recall: 1
- Pressure cohorts: 0.60, 0.75, 0.85, 0.95, emergency
- Turn cohorts: 50, 200, 1000
## Worst Cases
- S1: missing=0, staleLeaks=0
- S2: missing=0, staleLeaks=0
- S3: missing=0, staleLeaks=0
- S4: missing=0, staleLeaks=0
- S5: missing=0, staleLeaks=0
- S6: missing=0, staleLeaks=0
- S7: missing=0, staleLeaks=0
- S8: missing=0, staleLeaks=0
- S9: missing=0, staleLeaks=0
- S11: missing=0, staleLeaks=0
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.