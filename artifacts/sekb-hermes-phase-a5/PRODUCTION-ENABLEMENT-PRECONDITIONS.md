# SEKB Hermes Production Enablement Preconditions

This document lists gates **outside** Tier A merge and Tier B grayscale.

## Required before claiming production benefit

1. Tier B grayscale: stable capture with Host/CLI/Gateway same state dir; export == sqlite counts
2. Tier C dual-review authority — **one of**:
   - **(A) Live-human:** >=200 **live human** dual-reviewed trajectories (not automated_smoke), with process provenance; **or**
   - **(B) Permanent agent-proxy + residual-risk register:** >=200 agent dual-review proxy pairs, hard gates green, and `tier-c/PROXY-LABEL-AUTHORITY.md` records `n1Status=pass_proxy_permanent`  
     - **Current campaign: path (B)**  
     - Path (B) **never** authorizes the claim "human dual-review production-ready"
3. Agreement: Cohen's kappa >= 0.70 with zero unresolved disagreements after adjudication
4. Holdout (no weight/threshold retune on holdout):
   - valuable recall >= 0.95 under frozen Shadow V1 score >= 50
   - projected false drop <= 0.02
5. Privacy review of export schema remains keyed-pseudonymous
6. Operator report never fabricates acceptance / edit-distance when batch evidence missing
7. Rollback drill: flag-off restores baseline (no ambient capture / shadow / batch)

## Still forbidden until explicit phase approval

- Phase C scheduler ambient / default-on (dedicated Phase C flag must remain default-off except isolated observation)
- Phase D capture filtering as authority
- Automatic principle / ContextBlock durable writes
- Shadow V1 retune without a separate holdout protocol
- Treating path (B) agent-proxy as live-human dual-review equivalence

## Authority

Offline artifacts under `artifacts/sekb-hermes-phase-a5/` never drive runtime decisions.

## Label origin honesty (binding)

| Field | Current |
| --- | --- |
| `labelOrigin` | `agent_dual_review_proxy` |
| `n1Status` | `pass_proxy_permanent` |
| Live-human dual-review | not performed |

## Tier D (after Tier C offline Go)

See `artifacts/sekb-hermes-phase-a5/tier-d/D0-PROMOTION-DECISION-PACK.md`.

1. D0 decision pack complete (design only; no runtime mutation)
2. Product/tech written approval for D1 before Phase C would_trigger implementation
3. D1 mutation-free evidence + observation before any D2 pilot
4. Separate written approval for D2; preferred surface = operator ranking
5. `evaluable_for_promotion=true` still does **not** mean production filtering
6. Full default-on filtering remains forbidden until a later explicit product decision beyond D2
7. Under path (B), production benefit claims that require live-human dual-review remain **blocked** even if offline Go and Pass-D1 are true