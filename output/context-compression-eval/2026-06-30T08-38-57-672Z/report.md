# Context Compression Eval Report

- Run ID: 2026-06-30T08-38-57-672Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 30
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 30 samples
- LLM continuation: deepseek/deepseek-chat on 30 samples

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1717, density=5.8313 | PASS |
| L2 Faithfulness | score=10, causal=1, actionability=1 | deterministic baseline |
| L2 LLM Judge | score=0.4733, accuracy=0.8667, actionability=0 | sampled |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=0.5667, critical=0.0667, noRepeat=1, delta=1 | FAIL |

## Notes

- No API key is persisted in this report.
- L2 LLM judge executed through environment credentials; no API key is persisted.
- L3 LLM continuation executed through environment credentials; no API key is persisted.
