# Context Compression Eval Report

- Run ID: 2026-06-30T06-10-49-105Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 6
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 3 samples

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=0.7333, compression=0.0093, density=78.7027 | FAIL |
| L2 Faithfulness | score=8, causal=1, actionability=0.6667 | deterministic baseline |
| L2 LLM Judge | score=0.2667, accuracy=0.6667, actionability=0 | sampled |
| L3 Downstream | first=0.6667, critical=0.6667, noRepeat=0.6667, delta=0.3333 | FAIL |

## Notes

- No API key is persisted in this report.
- L2 LLM judge executed through environment credentials; no API key is persisted.
- L3 uses synthetic action traces derived from the target project conventions; real runtime traces should be mapped to the same action schema next.
