# LoCoMo retrieval-only diagnosis run-02: full 500-question sample (#136)

- Date: 2026-10-13 (Asia/Shanghai); `driven_by: agent`; actor `codex-locomo-evaluator`
- Mode: **retrieval-only L0** -- no answer generated, no judge called, no model credential used
- Sample: the **full 500-question stratified sample** (`FULL_EVAL=1`), run through `scripts/run-locomo-full-evaluation.mjs --retrieval-only`
- 121 s of work; `retrievalOnlyVerified: true`; `locomo-full-500-report.json` absent (`eval:runtime-memory:locomo:verify` still fails closed)

## Result

| Metric | full 500 | dev slice (run-01, 150) |
| --- | --- | --- |
| gold coverage in extracted memory | 0.9007 | 0.8947 |
| gold coverage in retrieved top-5 | 0.4078 | 0.4079 |
| `absent_from_memory` | 0 | 0 |
| `in_memory_but_not_top5` | 446 | 136 |
| `retrieved_in_top5` | 50 | 12 |
| `no_gold_evidence` | 4 | 2 |
| run's own `recall5Mean` | 0.3760 | 0.3292 |

Per-category top-5 coverage (full 500): `{"temporal": 0.4344, "multi_hop": 0.4011, "single_hop": 0.3622, "open_domain": 0.4272}`

Per-category memory coverage (full 500): `{"temporal": 0.8928, "multi_hop": 0.8904, "single_hop": 0.9268, "open_domain": 0.8917}`

Temporal vs the other categories, same sample: 0.4344 vs 0.3964, delta **+0.0380** (comparable=True)

## What this says

- **Extraction is not the bottleneck anywhere in the sample.** `absent_from_memory` is 0/500; memory coverage is 0.9007 overall and 0.890-0.927 in every category.
- **Ranking is the bottleneck.** 89.2% of the sample (446/500) has its gold evidence in memory but not in the fused top-5; only 50/500 reach the top-5.
- **Temporal is the best category, not the worst.** Temporal top-5 coverage 0.4344 beats single_hop 0.3622, multi_hop 0.4011 and open_domain 0.4272, and is +0.0380 against the pooled non-temporal questions. The dev-slice direction (+0.0890) held on the full sample.
- 4/500 rows have no resolvable gold turn and cannot evidence retrieval either way.

## Boundaries (do not over-read this)

- **L0 only**: no self-ask, no L1/L2 escalation, no generation, no judge. The full pipeline adds those stages and changes some top-5s, so this does not describe the final assembled context and is not a J-score result.
- Coverage is a **lexical proxy** (a gold turn counts as covered at >= 0.8 of its >3-character words), not semantic entailment. `memoryCoverage` means the words are present in some extracted fact, not that the fact is complete.
- No judge score, no baseline, no product claim; `assertRetrievalOnlyDisclosure` enforces the disclosure fields.
- The observations cache is still missing 4 conversations; L0 fact retrieval does not use it.

## Files

- `retrieval-diagnostic.json` sha256 `cec3a4ffa9012a67c02423d3ff9de7474654b7c8113d819c7f3748787b8c1c1a`
- `retrieval-only.json` sha256 `fd773c7903a7a1db1da450fb1b67ebc9e2ec160cdbcafc39f44eb2b1d17e2892`
- `progress-timeline.jsonl` sha256 `864a00a735f9f4b8f6cf3e6e7fa3e4136fcedadd4e4d3b383cd1aabf799f6c9d`
- `run-budget.json` sha256 `015972fec42b4e71855375fbe909e1f03f920aab7003196e2a9d9286d0d6b7e7`
- `resume-seed.json` sha256 `2dac5658e300551c35b1ec31e06eb5c6ce258508906283953b09d5e7a5270f7b`
