# Context Compression Eval Report
- Run ID: 2026-07-01T03-14-52-432Z
- Target: C:\Users\27933\Desktop\clawx\ClawX
- Suite: daily
- Sample source: real
- Samples: 10
- Real/Synthetic: 10/0
- Evidence insufficient: no
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 10 samples
- LLM continuation: deepseek/deepseek-chat on 10 samples
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1507, density=6.7566 | PASS |
| L2 Faithfulness | score=10, min=10, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=10, min=10, accuracy=1, actionability=1 | PASS |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=1, critical=1, noRepeat=1, delta=0 | PASS |
## Cohorts
- Real samples: 10, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.60, 0.75, 0.85, 0.95, emergency
- Turn cohorts: 50, 200, 1000
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.