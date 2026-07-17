# Goal A / A1 COMPLETE — C1 graduation decision

**SHA**: `60061e335`
**completionClass**: `done (sim)`
**meetsGate**: false
**recommendation**: `keep-off`
**defaultsUnchanged**: true

## Evidence

- Sim fixtures: 12, reduction 5.083x, simGate=true
- Live A/B: blocked (Live A/B corpus + comms:replay binding + owner scorecard window missing (see reports/CODING-C1-LIVE-AB.md))
- View tools default: OFF

## Decision

Keep view tools / tool-registry / working-memory default-off. Sim-only evidence is not enough for production default flip.

## Artifacts

- `artifacts/coding-prod-a1/decision.json`
- `artifacts/coding-prod-a1/acceptance.json`
- `artifacts/coding-prod-a1/gates.json`
