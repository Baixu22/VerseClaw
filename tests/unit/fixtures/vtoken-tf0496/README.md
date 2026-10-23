# TF-0496 VToken keep-or-retire decision

- Task: `TF-0496` - decide VToken retention or retirement on real provider usage
- Actor: `codex` | Evidence driver: `agent`
- Decision: **retired** | Release boundary: no public release, GA, liveReady or productApproved claim

## How the decision was made

1. `ab-protocol.json` was frozen **before** any provider call: paired design, 30 pairs across four
   strata (short/long context x English/Chinese question), provider-reported input tokens, quality,
   p95 latency, a 10% materiality bar, a quality non-inferiority bound and a p95 latency bound.
2. `contexts.json` holds information-equivalent pairs produced by the real VToken code path
   (`p21_write_efficiency.to_markdown` vs `to_vt_full`).
3. `run-ab.mts` was executed exactly once (`ab-run.json`); it refuses to rerun.

## Result

| quantity | value |
|---|---|
| pairs / provider errors | 30 / 0 |
| input tokens | control 611.6 -> treatment 585.0 |
| mean reduction | 26.6 tokens, 95% CI [19.8, 34.0] |
| relative reduction | 4.35% (bar: 10%) |
| quality | control 0.50 vs treatment 0.70 |
| p95 latency ratio | 1.117 (bound 1.25) |
| decision | **retire-or-hold** (reasons: materialTokenWin) |

## What was applied

- Runtime: `resolveVtokenAssemblyConfig` always resolves `enabled: false`; `shouldAssembleVtokenWorkingContext`
  always returns false; `VTOKEN_RETIRED` records the decision. Config and environment can no longer enable it.
- Host: `readVtokenBridgeEnabledFromEnv()` always returns false and `setVtokenBridgeEnabled(true)` is refused,
  so the Python/uv sidecar is never launched. `VTOKEN_BRIDGE_RETIRED` records the decision.
- `docs/dev/vtoken-retirement-decision.md` holds the decision, migration and rollback record.

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| A/B report has real tokens, cache, p95 latency, quality and CIs | pass | `ab-run.json`; `raw-evidence.json#acceptanceCriteria[0]` |
| If kept: internalise as CRK policy and delete Bridge panel/public flag | not-applicable | materiality bar failed, keep path unused |
| If retired: remove production call and docs entry, keep migration/rollback record | pass | `09-retirement-audit.txt`; `docs/dev/vtoken-retirement-decision.md` |
| Neutral / quality-loss / no-usage must be retire-or-hold with a deadline, never permanent default-off | pass | `ab-run.json decision=retire-or-hold`; enable paths removed |

## Gates

See `verification.json`: decision consistency, host retirement suites, runtime injection suite,
typecheck, lint, contract, no-BOM, diff check, retirement audit, scope audit, checksum check.

## Unverified boundary

- The VToken Bridge settings panel still exists (now reporting a retired status); deleting it is
  `TF-0505` surface cleanup because `src/components/settings/` is outside this node paths.
- The A/B measures the packing format on the p21 corpus; it does not read provider billing.
- Agent-driven only; no human evidence is claimed.
