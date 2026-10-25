# VToken retirement decision (TF-0496)

- Date: 2026-10-23 (agent-driven, actor `codex`)
- Node: `TF-0496` — use real provider usage to decide VToken keep-or-retire
- Status: **retired**. The production injection path and the public enable flag are disabled.
- Boundary: no public release, GA, liveReady or productApproved claim; no product default was flipped.

## What was measured

A paired A/B was predeclared (`tests/unit/fixtures/vtoken-tf0496/ab-protocol.json`) and then run once
against a live provider. Both arms carried the *same* scenario information: the control arm as the
real markdown rendering (`p21_write_efficiency.to_markdown`) and the treatment arm as the real VToken
packing (`p21_write_efficiency.to_vt_full`). Token counts are **provider-reported usage**, never a
character estimate.

| quantity | value |
|---|---|
| pairs / provider errors | 30 / 0 |
| control mean input tokens | 611.6 |
| treatment mean input tokens | 585.0 |
| mean reduction | 26.6 tokens, 95% CI [19.8, 34.0] |
| relative reduction | 4.35% |
| quality (contains the expected fact) | control 0.50 vs treatment 0.70, delta CI [0.00, 0.40] |
| p95 latency | control 7175 ms vs treatment 8012 ms (ratio 1.117) |
| cached input tokens reported | true |

## Decision

The predeclared materiality bar required a mean reduction with a positive CI **and** at least a 10%
relative win. The measured relative reduction was 4.35%, so
`materialTokenWin` failed and the protocol decision is **retire-or-hold**. Quality was non-inferior
(the treatment was in fact better on this sample) and p95 latency stayed inside the 1.25x bound, so the
only failing condition is materiality — a ~4% token win does not justify shipping a Python/uv sidecar
and a user-visible surface.

Retirement (rather than an open-ended hold) was chosen because the node exists precisely to end the
"neither a product capability nor a concluded ROI" state, and because a hold would still pay the
dependency cost. A deadline-bounded hold remains the documented alternative if the decision is ever
revisited.

## Migration and rollback record

What is now inert:

- `openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts`: `resolveVtokenAssemblyConfig`
  always resolves `enabled: false`, `shouldAssembleVtokenWorkingContext` always returns `false`, and
  `VTOKEN_RETIRED` records why. No runtime config or environment value can re-enable injection.
- `electron/services/vtoken-bridge.ts`: `readVtokenBridgeEnabledFromEnv()` always returns `false` and
  `setVtokenBridgeEnabled(true)` is refused, so the sidecar is never launched. `VERSE_VTOKEN_BRIDGE_ENABLED`
  is kept only as a recognised-but-ignored name to avoid surprising older scripts.

Rollback (if the decision is reversed):

1. Revert the two `VTOKEN_RETIRED` / `VTOKEN_BRIDGE_RETIRED` guards; the previous opt-in gates are still
   present in git history at commit `15bb85f8c` (parent of this change).
2. Re-run `tests/unit/fixtures/vtoken-tf0496/run-ab.mts` under a **new** predeclared protocol; the current
   `ab-run.json` is frozen and the runner refuses to overwrite it.
3. A reversal must clear the same 10% materiality bar, otherwise the capability stays retired.

## Residual surface (tracked, not silently dropped)

The original TF-0496 run left a retired compatibility panel for TF-0505. The subsequent surface-cleanup node removed its user entry. The inert host API retains its compatibility shape; enabling the retired bridge remains refused.

## Evidence

- `tests/unit/fixtures/vtoken-tf0496/ab-protocol.json` (frozen before the run)
- `tests/unit/fixtures/vtoken-tf0496/contexts.json` (the information-equivalent raw/VT pairs)
- `tests/unit/fixtures/vtoken-tf0496/ab-run.json` (the single deciding run)
- `tests/unit/fixtures/vtoken-tf0496/verification.json` (gate ledger)
