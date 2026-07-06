# Context Compression Eval Report
- Run ID: 2026-07-01T10-27-23-509Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 500
- Real/Synthetic: 500/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: disabled
- Manifest: input resolved=500/500
- LLM judge: not executed
- LLM judge calibration: not executed
- LLM schema-free: not executed
- LLM live rerun: not executed
- LLM continuation: not executed
- Human eval pack: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T10-27-23-509Z\human-eval-pack.jsonl
- Human eval status: missing_ratings
- Runtime: 128103 ms (3.9031 samples/s)
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| Information Loss | verifiedRetention=1, loss=0, criticalDropped=0 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1884, density=5.9086 | PASS |
| Token Economics | inputSavings=13266452, outputDelta=0, netDelta=-13266452 | INFO |
| L2 Faithfulness | score=10, min=10, std=0, causal=1, actionability=1 | PASS deterministic |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | n=497, withoutCritical=0.33, withCritical=1, paired=sample_size_ok | PASS |
## Cohorts
- Real samples: 500, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.6, 0.75, 0.85, 0.95, emergency
- Turn cohorts: 50, 200, 1000
## Degradation Curve
| Pressure | Samples | Compression | Verified retention | Loss | Critical action | Completion delta |
|---|---:|---:|---:|---:|---:|---:|
| 0.6 | 101 | 0.1905 | 1 | 0 | 1 | 0 |
| 0.75 | 99 | 0.1924 | 1 | 0 | 1 | 0 |
| 0.85 | 100 | 0.1814 | 1 | 0 | 1 | 0 |
| 0.95 | 103 | 0.1837 | 1 | 0 | 1 | 0 |
| emergency | 97 | 0.1942 | 1 | 0 | 1 | 0 |
## Human Evaluation
- Pack path: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T10-27-23-509Z\human-eval-pack.jsonl
- Status: missing_ratings
- Rated samples: 0
- Human-auto Pearson: n/a
- Human-auto Spearman: n/a
## Failure Chain Schema Risk
- Chains: 1336
- Mean confidence: 0.75
- Low confidence chains: 59
- Risk: some_failure_chains_have_missing_evidence_links
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.