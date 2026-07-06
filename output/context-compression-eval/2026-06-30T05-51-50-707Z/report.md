# Context Compression Eval Report

- Run ID: 2026-06-30T05-51-50-707Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 12
- Semantic matching: disabled

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=0.7333, compression=0.009, density=81.8925 | FAIL |
| L2 Faithfulness | score=8.5, causal=1, actionability=0.75 | deterministic baseline |
| L3 Downstream | first=0.75, critical=0.75, noRepeat=0.75, delta=0.25 | FAIL |

## Notes

- No API key is persisted in this report.
- L2 is deterministic here; a separate new-window run can enable a real LLM judge via environment variables.
- L3 uses synthetic action traces derived from the target project conventions; real runtime traces should be mapped to the same action schema next.
