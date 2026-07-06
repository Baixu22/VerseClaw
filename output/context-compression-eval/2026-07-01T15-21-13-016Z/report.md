# Context Compression Eval Report
- Run ID: 2026-07-01T15-21-13-016Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Suite: full
- Sample source: real
- Samples: 30
- Real/Synthetic: 30/0
- Evidence insufficient: no
- Semantic matching: disabled
- Cache: disabled
- Manifest: input resolved=30/30
- LLM judge: not executed
- LLM judge calibration: not executed
- LLM schema-free: not executed
- LLM live rerun: not executed
- LLM continuation: not executed
- Human eval pack: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T15-21-13-016Z\human-eval-pack.jsonl
- Human eval status: missing_ratings
- Agent manual eval status: sufficient_ai_review
- Runtime: 21109 ms (1.4212 samples/s)
- Acceptance: PASS
## Summary
| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| Information Loss | verifiedRetention=1, loss=0, criticalDropped=0 | PASS |
| L1 Fidelity | wRecall=1, compression=0.2004, density=5.9084 | PASS |
| Token Economics | inputSavings=1254634, outputDelta=0, netDelta=-1254634 | INFO |
| L2 Faithfulness | score=10, min=10, std=0, causal=1, actionability=1 | PASS deterministic |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| Hunk A/B | n=30, withoutCritical=0.4333, withCritical=1, paired=sample_size_ok | PASS |
## Cohorts
- Real samples: 30, L1 weighted recall: 1
- Synthetic samples: 0, L1 weighted recall: 1
- Pressure cohorts: 0.95, 0.85, emergency, 0.75, 0.6
- Turn cohorts: 50, 200, 1000
## Degradation Curve
| Pressure | Samples | Compression | Verified retention | Loss | Critical action | Completion delta |
|---|---:|---:|---:|---:|---:|---:|
| 0.6 | 1 | 0.1573 | 1 | 0 | 1 | 0 |
| 0.75 | 1 | 0.2589 | 1 | 0 | 1 | 0 |
| 0.85 | 3 | 0.1328 | 1 | 0 | 1 | 0 |
| 0.95 | 14 | 0.1916 | 1 | 0 | 1 | 0 |
| emergency | 11 | 0.2286 | 1 | 0 | 1 | 0 |
## Human Evaluation
- Pack path: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T15-21-13-016Z\human-eval-pack.jsonl
- Status: missing_ratings
- Rated samples: 0
- Human-auto Pearson: n/a
- Human-auto Spearman: n/a
## Agent Manual Evaluation
- Disclosure: AI reviewer manual analysis. Do not count as real human developer ratings.
- Pack path: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T15-21-13-016Z\human-eval-pack.jsonl
- Ratings path: C:\Users\27933\Desktop\clawx\ClawX\output\context-compression-eval\2026-07-01T10-22-44-091Z\agent-manual-eval-ratings.jsonl
- Status: sufficient_ai_review
- Rated samples: 20
- Reviewer-auto Pearson: n/a
- Reviewer-auto Spearman: n/a
## Failure Chain Schema Risk
- Chains: 107
- Mean confidence: 0.7607
- Low confidence chains: 2
- Risk: some_failure_chains_have_missing_evidence_links
## Worst Cases
- None.
## Notes
- Transcript files are read-only inputs and are not modified.
- Report artifacts store redacted metadata and metrics only; no environment credential is persisted.
- Full suite fails independently when the real cohort lacks required coverage.