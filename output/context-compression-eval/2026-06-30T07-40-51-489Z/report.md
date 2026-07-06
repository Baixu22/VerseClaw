# Context Compression Eval Report

- Run ID: 2026-06-30T07-40-51-489Z
- Target: C:\Users\27933\Desktop\verseshell\graphiti-main
- Samples: 12
- Semantic matching: disabled
- LLM judge: not executed
- LLM continuation: not executed

## Summary

| Layer | Key metrics | Gate |
|---|---|---|
| L0 Link | recall=1, stale=1 | PASS |
| L1 Fidelity | wRecall=1, compression=0.1718, density=5.8241 | PASS |
| L2 Faithfulness | score=10, causal=1, actionability=1 | deterministic baseline |

| L3 Downstream | first=1, critical=1, noRepeat=1, delta=0 | PASS |


## Notes

- No API key is persisted in this report.
- L2 is deterministic here; pass --llm-judge with DEEPSEEK_API_KEY in the environment for real LLM judge.
- L3 uses synthetic action traces derived from the target project conventions; pass --llm-continuation for real model continuation planning.
