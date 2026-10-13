# LoCoMo measured run-01: full 500-question generation + judge (#135, #136, #138)

- Date: 2026-10-13 (Asia/Shanghai); `driven_by: agent`; actor `codex-locomo-evaluator`
- Mode: **full 500-question stratified sample**, real generation + frozen judge + real local embeddings
- Command: `scripts/run-locomo-full-evaluation.mjs` (segment 2 seeded with `--resume-from` the segment-1 journal)
- Judge model: `qwen2.5-7b-instruct` (`frozen-v2-generous-2026-07-04`, temperature 0)
- Embeddings: `llama.cpp-qwen3-embedding-8b-q4_k_m` / local-llama.cpp / Q4_K_M, server build `b11429-d81235049`, loopback endpoint
- Verifier: `scripts/check-locomo-evidence.mjs` -> `verified: true`, 4881 model receipts, 52 hashed sources
- Tracked fixture: `tests/fixtures/runtime-memory-eval/locomo-full-500-measured-report.json` sha256 `ecf1e69884a14630783a3baadff3e9d5214bcd5acd06f1c7a75f794cd00b2858`

This is a **new local-deployment reference**, not a reproduction or validation of the historical
unverified 0.752 / 0.452 numbers, and not a product-readiness or memory-on/off claim.

## Result (all 500 questions)

| Scope | n | J Score | Recall@5 | Context recall |
| --- | --- | --- | --- | --- |
| OVERALL | 500 | 0.5580 | 0.3820 | 0.7369 |
| temporal | 150 | 0.6333 | 0.4374 | 0.8178 |
| multi_hop | 96 | 0.4583 | 0.2034 | 0.6362 |
| single_hop | 127 | 0.4961 | 0.3062 | 0.6493 |
| open_domain | 127 | 0.6063 | 0.5275 | 0.8051 |

Escalation disclosure (rule: separate the L0+L1 subset from full-conversation fallback):

- L0 487 (0.974), L1 11 (0.022), L2 2 (0.004); capped 0
- `memory_only` (L0+L1 only, excludes L2): n=498, J=0.5602, Recall@5=0.3836
- Selection bias is explicit in the report: `Excludes questions escalated to full conversation after insufficient retrieved evidence; not an unbiased memory score or a memory-on/off comparison. L1 includes retrieved whole sessions.`
- `scoreAttribution`: Overall J Score includes non-retrieval full-conversation contributions from L2; metrics.memory_only excludes L2 and is explicitly selection-biased.
- Judge coverage: judgeCacheHits=0, judgeCacheMisses=500, cachedRetrieval=false

## #136 retrieval attribution (written beside the report, never inside it)

| Metric | full 500 |
| --- | --- |
| gold coverage in extracted memory | 0.9007 |
| gold coverage in retrieved top-5 | 0.4122 |
| `no_gold_evidence` | 4 |
| `absent_from_memory` | 0 |
| `in_memory_but_not_top5` | 445 |
| `retrieved_in_top5` | 51 |
| run's own `recall5Mean` | 0.3820 |

Temporal vs pooled non-temporal, same sample: top-5 coverage 0.4356 vs
0.4022, delta **+0.0333** (comparable=true).

Per-category top-5 coverage: temporal 0.4356, multi_hop 0.4014, single_hop 0.3662, open_domain 0.4390.

Reading: extraction is not the bottleneck (`absent_from_memory` 0/500); ranking is
(445/500 have the gold evidence in memory but outside the fused top-5). Temporal is **not** the
worst category here, so the historical "temporal regressed while J rose" reading does not reproduce on this
sample; the comparator's independent retrieval-regression gate is what keeps that question honest.

## Boundaries (do not over-read this)

- `recall_at_5` is the legacy gold-answer-token overlap proxy, not evidence-ID recall and not causal memory benefit.
- `context_recall` is lexical gold-turn coverage; empty or unresolved evidence scores zero.
- The judge is the frozen **lenient** configuration; its tolerances are published above. Scores under other
  judges are not comparable and establish no ranking.
- Retrieval diagnosis carries no judge score and no baseline claim (`assertRetrievalOnlyDisclosure` enforces it).
- No product default, product lock, cutover status or frozen value was changed to produce this run.

## Run history (why there are two segments)

1. Segment 1 (`locomo-final-20261013-1545`): 480 judged, 20 pending, **no report** — the suite fails closed on a
   partial answer set and wrote `run-progress.json` instead.
   - The judge `llama-server` died mid-run with `CUDA error: out of memory` (it was started with `-c 32768 --parallel 4`
     on an 8 GB GPU), so 14 questions were answered by `ECONNREFUSED`.
   - The first replacement still partitioned the context per slot (4096 tokens each); real requests reach 4381 tokens
     and the L2 full-conversation escalation sends ~26-31k tokens, so llama-server answered HTTP 400 while healthy.
   - Fixed by serving a **unified 32768-token KV pool** with q8_0 KV cache (`-c 32768 -np 3 -kvu -ctk q8_0 -ctv q8_0`),
     which serves the largest conversation (probed HTTP 200, 26406 prompt tokens).
2. Segment 2 (`locomo-resume-20261013-181217`): seeded from the segment-1 journal, re-asked only the 20 pending
   questions, and produced the verified 500/500 report.
   - The first segment-2 attempt produced a complete 500/500 report that the verifier **rejected** with
     `Receipt outside this run`: `journalStartedAt()` widened the logical-run window using retained *questions*
     only, while the report also retains the extraction receipts that precede the first judged question (124 s
     earlier). Fixed in `tests/unit/helpers/locomo-question-journal.ts` (commit `6391f7af4`) with a regression test,
     then regenerated.

## Files

- `locomo-full-500-report.sha256` sha256 `d052781c75a1e482c58c54531bbbb1b22a48769fe77589ff4b50e24f1c531ff3`
- `progress-timeline.jsonl` sha256 `fb98b9eadb6539add0af84c5337af4d4bd6dc097e22698ba38a49202439d12c0`
- `resume-seed.json` sha256 `dffab62beca349721eab259a2f640aa330e1930eb75fb4e9aead1e2908e94e8b`
- `retrieval-diagnostic.json` sha256 `7274b561f92167fdc8acd334c1f7715c74d5af883d00053e030976fc326610f8`
- `run-budget.json` sha256 `5be3709d1973e5f95c30e09d90404dda244f35ee85e2b80bb6dd94b5028b336c`
