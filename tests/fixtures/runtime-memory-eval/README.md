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

No placeholder measured report is checked in. Until an actual run passes, the default measured-report check fails. See [the P0 repair record](../../../docs/dev/p0-memory-evaluation-integrity.md).
