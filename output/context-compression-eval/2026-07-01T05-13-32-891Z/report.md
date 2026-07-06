# Context Compression Eval Report
- Run ID: 2026-07-01T05-13-32-891Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 47
- Real/Synthetic: 47/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: enabled hits=239 misses=26 writes=26
- Manifest: input resolved=47/120
- LLM judge: deepseek/deepseek-chat on 30 samples
- LLM continuation: deepseek/deepseek-chat on 30 samples
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1568, density=6.7564 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=9.7333, min=2, accuracy=0.9667, actionability=0.9667 | FAIL |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=1, critical=1, noRepeat=1, delta=0 | PASS |
## Cohorts
- Real samples: 47, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: emergency, 0.95, 0.85, 0.6, 0.75
- Turn cohorts: 50, 200, 1000
## Worst Cases
- R122: missing=0, staleLeaks=0
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.