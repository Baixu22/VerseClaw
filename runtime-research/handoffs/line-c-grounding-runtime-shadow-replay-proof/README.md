# Line C Grounding Phase D: Runtime Shadow Replay Proof

Status: accepted.

## Allowed Surface

- Offline or controlled shadow replay using sanitized production-like diagnostics metadata.
- Deterministic proof over accepted Line C consumers.
- Summary-only replay evidence with no raw payload retention.
- Required output markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

## Forbidden Surface

- Live runtime authority, prompt/model-message/provider transport injection, provider ordering changes, durable memory promotion, raw replay payload persistence, services/listeners/exporters, UI, patch apply, workspace edit, or symbol mutation.

## Implementation Prerequisites

- Accepted Phase C synthesis.
- Sanitized replay corpus, deterministic replay harness, no-raw-retention contract, baseline provider/order snapshots, and no-residue check.

## Tests

- Harness context and validate for this spec.
- Phase C spec validate with `--no-diff`.
- Grounding seven-file unit suite.
- TypeScript node check.
- Replay determinism, disabled parity, authority/raw/untrusted sentinel replay, provider ordering snapshot, budget/performance replay, no-residue scan, diff check, README review.

## Metrics

- Replay pass rate.
- Deterministic diff count: 0.
- Provider ordering diff count: 0.
- Context/evidence baseline diff count: 0.
- Raw leak count: 0.
- Authority leak count: 0.
- p95 replay overhead within budget.

## Rollback

- Remove replay artifacts and disable replay execution.
- Verify no raw replay corpus, sidecar, database, cache, or persistent replay output remains.

## Docs/i18n/E2E Requirements

- Replay report and README review required.
- No i18n/E2E unless a later accepted user-visible surface is added.

## Entry Criteria

- Phase C accepted.
- Replay corpus sanitized and approved.
- Baseline provider ordering and context/evidence snapshots defined.

## Exit Criteria

- Shadow replay proves diagnostics remain deterministic, non-authoritative, stable against baselines, and raw-free under production-like traces.

## Stop Conditions

- Replay requires raw prompts/traces/payloads, changes runtime behavior, persists raw data, or shows provider/order/runtime drift.
