# Context Compression Eval Report

- Run ID: 2026-06-30T06-20-00-881Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 27
- Semantic matching: disabled
- LLM judge: deepseek/deepseek-chat on 27 samples
- LLM continuation: deepseek/deepseek-chat on 27 samples

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=0.7333, compression=0.0081, density=92.4415 | FAIL |
| L2 Faithfulness | score=8.6667, causal=1, actionability=0.7778 | deterministic baseline |
| L2 LLM Judge | score=0.3111, accuracy=0.7407, actionability=0 | sampled |
| L3 Downstream | first=0.7407, critical=0.7407, noRepeat=0.7407, delta=0.2593 | FAIL |
| L3 LLM Continuation | first=1, critical=0.7407, noRepeat=1, delta=1 | FAIL |

## Notes

- No API key is persisted in this report.
- L2 LLM judge executed through environment credentials; no API key is persisted.
- L3 LLM continuation executed through environment credentials; no API key is persisted.
