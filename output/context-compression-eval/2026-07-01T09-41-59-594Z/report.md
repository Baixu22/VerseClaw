# Context Compression Eval Report
- Run ID: 2026-07-01T09-41-59-594Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: daily
- Sample source: real
- Samples: 5
- Real/Synthetic: 5/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: disabled
- Manifest: not used
- LLM judge: not executed
- LLM judge calibration: not executed
- LLM schema-free: not executed
- LLM live rerun: not executed
- LLM continuation: not executed
- Human eval pack: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T09-41-59-594Z\human-eval-pack.jsonl
- Human eval status: missing_ratings
- Runtime: 5444 ms (0.9184 samples/s)
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| Information Loss | verifiedRetention=1, loss=0, criticalDropped=0 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1705, density=6.0477 | PASS |
| Token Economics | inputSavings=101433, outputDelta=0, netDelta=-101433 | INFO |
| L2 Faithfulness | score=10, min=10, std=0, causal=1, actionability=1 | PASS deterministic |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | n=5, withoutCritical=0.4, withCritical=1, paired=underpowered | PASS |
## Cohorts
- Real samples: 5, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.6, 0.85, emergency
- Turn cohorts: 50, 200
## Degradation Curve
| Pressure | Samples | Compression | Verified retention | Loss | Critical action | Completion delta |
|---|---:|---:|---:|---:|---:|---:|
| 0.6 | 2 | 0.1852 | 1 | 0 | 1 | 0 |
| 0.85 | 1 | 0.1614 | 1 | 0 | 1 | 0 |
| emergency | 2 | 0.1604 | 1 | 0 | 1 | 0 |
## Human Evaluation
- Pack path: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T09-41-59-594Z\human-eval-pack.jsonl
- Status: missing_ratings
- Rated samples: 0
- Human-auto Pearson: n/a
- Human-auto Spearman: n/a
## Failure Chain Schema Risk
- Chains: 14
- Mean confidence: 0.6286
- Low confidence chains: 4
- Risk: some_failure_chains_have_missing_evidence_links
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.