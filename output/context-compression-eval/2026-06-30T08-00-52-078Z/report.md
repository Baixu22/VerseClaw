# Context Compression Eval Report

- Run ID: 2026-06-30T08-00-52-078Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 27
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 27 samples
- LLM continuation: deepseek/deepseek-chat on 27 samples

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1713, density=5.8433 | PASS |
| L2 Faithfulness | score=10, causal=1, actionability=1 | deterministic baseline |
| L2 LLM Judge | score=0.4889, accuracy=0.8519, actionability=0 | sampled |
| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |
| L3 LLM Continuation | first=0.6296, critical=0.1481, noRepeat=1, delta=1 | FAIL |

## Notes

- No API key is persisted in this report.
- L2 LLM judge executed through environment credentials; no API key is persisted.
- L3 LLM continuation executed through environment credentials; no API key is persisted.
