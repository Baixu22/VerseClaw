# Context Compression Eval Report
- Run ID: 2026-07-01T10-08-57-053Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: daily
- Sample source: real
- Samples: 5
- Real/Synthetic: 5/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: disabled
- Manifest: input resolved=5/5
- LLM judge: deepseek/deepseek-chat on 5 samples
- LLM judge calibration: executed scoreMean=4.4
- LLM schema-free: not executed
- LLM live rerun: not executed
- LLM continuation: not executed
- Human eval pack: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T10-08-57-053Z\human-eval-pack.jsonl
- Human eval status: missing_ratings
- Runtime: 49059 ms (0.1019 samples/s)
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| Information Loss | verifiedRetention=1, loss=0, criticalDropped=0 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1604, density=6.2362 | PASS |
| Token Economics | inputSavings=357898, outputDelta=0, netDelta=-357898 | INFO |
| L2 Faithfulness | score=10, min=10, std=0, causal=1, actionability=1 | PASS deterministic |
| L2 LLM Judge | score=10, min=10, std=0, hist={"10":5,"0-4.99":0,"5-6.99":0,"7-7.99":0,"8-8.99":0,"9-9.99":0}, actionability=1 | PASS |
| L2 Judge Calibration | score=4.4, min=2 | PASS |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | n=5, withoutCritical=0.6, withCritical=1, paired=underpowered | PASS |
## Cohorts
- Real samples: 5, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.95, 0.85, emergency
- Turn cohorts: 200, 1000
## Degradation Curve
| Pressure | Samples | Compression | Verified retention | Loss | Critical action | Completion delta |
|---|---:|---:|---:|---:|---:|---:|
| 0.85 | 1 | 0.1601 | 1 | 0 | 1 | 0 |
| 0.95 | 3 | 0.1603 | 1 | 0 | 1 | 0 |
| emergency | 1 | 0.1608 | 1 | 0 | 1 | 0 |
## Human Evaluation
- Pack path: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T10-08-57-053Z\human-eval-pack.jsonl
- Status: missing_ratings
- Rated samples: 0
- Human-auto Pearson: n/a
- Human-auto Spearman: n/a
## Failure Chain Schema Risk
- Chains: 20
- Mean confidence: 0.74
- Low confidence chains: 0
- Risk: no_low_confidence_failure_chains_detected
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.