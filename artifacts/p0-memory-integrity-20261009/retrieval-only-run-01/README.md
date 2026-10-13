# LoCoMo retrieval-only diagnosis run-01 (#136)

- Date: 2026-10-13 (Asia/Shanghai)
- `driven_by: agent`; actor: `codex-locomo-evaluator`
- Mode: **retrieval-only L0** -- no answer generated, no judge called, no model credential used
- Sample: dev slice, 150 questions (NOT the 500-question full sample)
- Source revision: d394368cf3824b418203742acf0d4c8f213f5a34
- `locomo-full-500-report.json` deliberately does not exist; `eval:runtime-memory:locomo:verify` still fails closed

## Measured result

| Metric | Value |
| --- | --- |
| questions | 150 |
| gold coverage in extracted memory (`memoryCoverage`) | 0.8947 |
| gold coverage in retrieved top-5 (`top5Coverage`) | 0.4079 |
| run's own `recall5Mean` | 0.3292 |

Bucket counts: `{"no_gold_evidence": 2, "absent_from_memory": 0, "in_memory_but_not_top5": 136, "retrieved_in_top5": 12}`

Per-category top-5 coverage: `{"temporal": 0.4785, "multi_hop": 0.4147, "single_hop": 0.381, "open_domain": 0.3889}`

Temporal vs the other categories in the same sample: temporal `top5Coverage` 0.4785, others 0.3895, delta +0.0890 (comparable=True)

## What this says

- **Extraction is not the loss.** `absent_from_memory` is 0 of 150: every gold turn with a resolvable id is covered by the conversation's extracted facts (`memoryCoverage` 0.8947).
- **Ranking is the loss.** `in_memory_but_not_top5` is 136 of 150 (90.7%%): the evidence is in memory but the fused top-5 does not contain it. `retrieved_in_top5` is 12.
- **Temporal is not worse here.** Temporal top-5 coverage (0.4785) is +0.0890 against the other categories (0.3895), i.e. better, not a regression.
- 2 questions have no resolvable gold turn (`no_gold_evidence`) and cannot evidence retrieval either way.

## Boundaries (do not over-read this)

- This is the **dev slice (150)**, not the 500-question full sample.
- This is **L0 only**: no self-ask, no L1/L2 escalation, no generation, no judge. The full pipeline adds those stages and changes some top-5s, so this does not describe the final assembled context.
- Coverage is a **lexical proxy** (a gold turn counts as covered at >= 0.8 of its >3-character words). It is not semantic entailment.
- No judge score and no baseline claim is made; `assertRetrievalOnlyDisclosure` enforces that. The observations cache is missing 4 conversations, which does not affect L0 fact retrieval.

## Files

- `retrieval-diagnostic.json` sha256 `76a0d79c4a7cbe0533c75c05be282a06018a11daef76ea7871e8b16c5559451e`
- `retrieval-only.json` sha256 `9f084737f7ec18eddede4f7480301c005779d3f531dbf8d1fa45f00702662847`
- `progress-timeline.jsonl` sha256 `79bbf123ec33165513fcd1362b75589af43c670ec0503c1316a7ec1f8c50f7ae`

The heartbeat confirms the pre-existing heap limit was the Node default: `heapLimitMb` 4288 throughout, peak `rssMb` ~1198.
