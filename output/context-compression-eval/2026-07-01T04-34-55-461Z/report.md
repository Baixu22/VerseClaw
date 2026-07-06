# Context Compression Eval Report
- Run ID: 2026-07-01T04-34-55-461Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 100
- Real/Synthetic: 100/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: enabled hits=1 misses=200 writes=200
- Manifest: not used
- LLM judge: deepseek/deepseek-chat on 100 samples
- LLM continuation: deepseek/deepseek-chat on 100 samples
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1552, density=6.8279 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=10, min=10, accuracy=1, actionability=1 | PASS |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=0.92, critical=0.93, noRepeat=1, delta=0.07 | PASS |
## Cohorts
- Real samples: 100, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.6, 0.75, 0.85, 0.95, emergency
- Turn cohorts: 50, 200, 1000
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.