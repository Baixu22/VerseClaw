# Context Compression Eval Report
- Run ID: 2026-07-01T07-19-49-740Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 30
- Real/Synthetic: 30/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: enabled hits=237 misses=36 writes=36
- Manifest: input resolved=30/30
- LLM judge: deepseek/deepseek-chat on 30 samples
- LLM continuation: deepseek/deepseek-chat on 30 samples
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1691, density=6.6163 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=9.8667, min=6, accuracy=1, actionability=0.9667 | PASS |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | withoutCritical=0.4, withCritical=1, withoutSpecificity=1, withSpecificity=1 | PASS |
| L3 LLM Continuation | first=1, critical=0.4333, noRepeat=1, delta=0.5667 | FAIL |
## Cohorts
- Real samples: 30, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.95, 0.85, emergency, 0.75
- Turn cohorts: 50, 200, 1000
## Worst Cases
- R122: missing=0, staleLeaks=0
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.