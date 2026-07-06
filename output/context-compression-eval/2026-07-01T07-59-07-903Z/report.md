# Context Compression Eval Report
- Run ID: 2026-07-01T07-59-07-903Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 30
- Real/Synthetic: 30/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: enabled hits=212 misses=1 writes=1
- Manifest: input resolved=30/30
- LLM judge: not executed
- LLM continuation: not executed
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1746, density=6.3036 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | withoutCritical=0.4333, withCritical=1, withoutSpecificity=1, withSpecificity=1 | PASS |
## Cohorts
- Real samples: 30, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.95, 0.85, emergency, 0.75, 0.6
- Turn cohorts: 50, 200, 1000
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.