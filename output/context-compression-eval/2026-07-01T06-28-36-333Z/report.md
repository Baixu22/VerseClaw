# Context Compression Eval Report
- Run ID: 2026-07-01T06-28-36-333Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 14
- Real/Synthetic: 14/0
- Evidence insufficient: yes
- Semantic matching: disabled
- Cache: enabled hits=206 misses=32 writes=32
- Manifest: input resolved=14/30
- LLM judge: deepseek/deepseek-chat on 14 samples
- LLM continuation: deepseek/deepseek-chat on 14 samples
- Acceptance: FAIL
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1724, density=6.8709 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=10, min=10, accuracy=1, actionability=1 | PASS |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | withoutCritical=0.5, withCritical=1, withoutSpecificity=1, withSpecificity=1 | PASS |
| L3 LLM Continuation | first=1, critical=0.5, noRepeat=1, delta=0.5 | FAIL |
## Cohorts
- Real samples: 14, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.95, 0.85, emergency
- Turn cohorts: 50, 200, 1000
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.