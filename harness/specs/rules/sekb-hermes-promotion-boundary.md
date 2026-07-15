---
id: sekb-hermes-promotion-boundary
title: SEKB Hermes promotion boundary
type: ai-coding-rule
appliesTo:
  - sekb-hermes-gap-closure
  - sekb-hermes-tier-d-promotion-decision
  - sekb-hermes-phase-c-would-trigger
  - sekb-hermes-phase-d-active-pilot
requiredProfiles:
  - fast
---

# Boundary: SEKB Hermes promotion

- Shadow V1 retain threshold is frozen at **50**; holdout retune is forbidden.
  If V1 is insufficient after human dual-review, define **Shadow V2** with a
  fresh holdout protocol — do not retune V1 on the original holdout.
- Phase C scheduler and Phase D capture filtering must not be activated in 档 A
  or under incomplete Tier C evidence.
- Automated dual-smoke labels (`labelAuthority=automated_smoke_not_human`) prove
  pipeline only; they cannot set `evaluable_for_promotion=true`.
- Quantitative promotion requires separate human dual-review campaign and gates
  (see design doc production preconditions and tier-c GO-NO-GO).
- `evaluable_for_promotion=true` is offline evidence only; it is **not** live
  production filtering and does not alone authorize runtime mutation.
- Tier D layering is mandatory:
  - **D0** decision package (no runtime mutation)
  - **D1** mutation-free `would_trigger` evidence (after Tier C green + written approval)
  - **D2** minimal active pilot (after D0+D1 + separate written approval)
- Preferred first pilot surface is operator review ranking / candidate priority,
  not full capture filtering.
- Any future pilot remains default-off with single-flag rollback and no reverse
  migration dependency.
- See also: `harness/specs/rules/sekb-hermes-tier-d-boundary.md` and
  `artifacts/sekb-hermes-phase-a5/tier-d/D0-PROMOTION-DECISION-PACK.md`.
