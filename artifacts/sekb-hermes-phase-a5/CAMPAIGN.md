# SEKB Hermes Evaluation Campaign Notes

## Tier A / A.5 (closed for merge readiness)
- Library + Host/CLI ops landed default-off
- Offline dual-review kit non-authoritative
- Automated dual-smoke proves pipeline only

## Tier B - grayscale observation
Status: local canary recorded (see GRAYSCALE-OBSERVATION.md)

## Tier C - human dual-review + usefulness closed loop
Status: **human_dual_review_gates_passed_evidence_only**
- Script: `scripts/sekb-tier-c-campaign.mjs` (`pnpm sekb:tier-c:campaign`)
- Kit: `artifacts/sekb-hermes-phase-a5/tier-c/`
- labelAuthority: **human_dual_review**
- dual-reviewed pairs: **200**
- evaluable_for_promotion: **true**
- decision: **Go**

### Explicit non-goals
- No automated_smoke as human labels
- No Shadow V1 retune / Phase C/D / auto principle writes
- No treating evaluable_for_promotion as live filtering

## Production enablement
Deferred until hard gates pass. See PRODUCTION-ENABLEMENT-PRECONDITIONS.md and tier-c/GO-NO-GO.md.
