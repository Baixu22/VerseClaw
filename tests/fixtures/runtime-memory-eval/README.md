# Runtime-memory evaluation fixtures

## Historical aggregates are not measured baselines

The three LoCoMo aggregate files below lack a complete verifiable run record. Their numbers (including 0.452 and 0.752) are retained for historical schema inspection only. They do **not** establish memory quality, temporal retrieval improvement, or a cross-system ranking. Their original bytes and historical timestamps have not been rewritten.

| Historical file | SHA-256 of preserved bytes |
|---|---|
| locomo-full-500-report-phase3-baseline.json | c481b4fb0913aa25af9327661efd683643e1a4bde6941fe547e5c8ea48249229 |
| locomo-full-500-report-phase4.0-regression.json | ba37c88a3eae8d047ef2720804dea2cfabf0556779af28e1c5d54719ef5f244f |
| locomo-full-500-report.json | d65dd7cdd93f0306fce93cb8363ce107ba60a8606c94607cf3a9d6590cd377df |

The comparator's low-level reader may inspect them, but baseline adoption rejects them. Unit-test payloads are explicitly synthetic; a passing consistency test is not a real model run.

## New measured reports

Use the agent-driven full-evaluation entry point and retain its fresh output directory. A curated full report must include all 500 sampled questions, retrieval inputs, complete judge configuration, L0/L1/L2 attribution, model receipts, non-secret configuration, source/dataset hashes and its adjacent .sha256 file. Run `pnpm eval:runtime-memory:locomo:verify --report <report.json>` before adopting it.

### Adopted measured report

| Field | Value |
|---|---|
| File | `locomo-full-500-measured-report.json` |
| SHA-256 | `ecf1e69884a14630783a3baadff3e9d5214bcd5acd06f1c7a75f794cd00b2858` |
| Run id | `ec89540e-12b6-4cbd-9dae-89bc10b1b672` |
| Judge model | `qwen2.5-7b-instruct` (`frozen-v2-generous-2026-07-04`, temperature 0) |
| Embeddings | `llama.cpp-qwen3-embedding-8b-q4_k_m` / local-llama.cpp / Q4_K_M |
| Questions | 500 (judge cache hits 0, misses 500) |
| Model receipts | 4881 |
| Generated | 2026-10-13T10:18:51.290Z |
| Agent run | `driven_by: agent`, actor `codex-locomo-evaluator` |

| Scope | n | J Score | Recall@5 | Context recall |
| --- | --- | --- | --- | --- |
| OVERALL | 500 | 0.5580 | 0.3820 | 0.7369 |
| temporal | 150 | 0.6333 | 0.4374 | 0.8178 |
| multi_hop | 96 | 0.4583 | 0.2034 | 0.6362 |
| single_hop | 127 | 0.4961 | 0.3062 | 0.6493 |
| open_domain | 127 | 0.6063 | 0.5275 | 0.8051 |

L0 487 / L1 11 / L2 2; `memory_only` (L0+L1, selection-biased)
J=0.5602 on n=498.

This is a **new local-deployment reference** established by an agent-driven run. It is not a reproduction or
validation of the historical 0.752 / 0.452 aggregates, not a memory-on/off comparison, and not a
product-readiness claim. The frozen judge is deliberately lenient; its tolerances are recorded in the report and
scores under other judges are not comparable. Curated run evidence lives in
[`artifacts/p0-memory-integrity-20261009/measured-run-01-full500/`](../../../artifacts/p0-memory-integrity-20261009/measured-run-01-full500/README.md).
See [the P0 repair record](../../../docs/dev/p0-memory-evaluation-integrity.md).
