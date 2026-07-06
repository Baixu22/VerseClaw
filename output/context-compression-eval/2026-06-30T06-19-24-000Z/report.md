# Context Compression Eval Report

- Run ID: 2026-06-30T06-19-24-000Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 2
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 2 samples
- LLM continuation: deepseek/deepseek-chat on 2 samples

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=0.6667, compression=0.0087, density=76.2894 | FAIL |
| L2 Faithfulness | score=7, causal=1, actionability=0.5 | deterministic baseline |
| L2 LLM Judge | score=0.2, accuracy=0.5, actionability=0 | sampled |
| L3 Downstream | first=0.5, critical=0.5, noRepeat=0.5, delta=0.5 | FAIL |
| L3 LLM Continuation | first=1, critical=0.5, noRepeat=1, delta=1 | FAIL |

## Notes

- No API key is persisted in this report.
- L2 LLM judge executed through environment credentials; no API key is persisted.
- L3 LLM continuation executed through environment credentials; no API key is persisted.
