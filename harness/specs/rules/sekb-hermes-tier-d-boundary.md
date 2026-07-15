---
id: sekb-hermes-tier-d-boundary
title: SEKB Hermes Tier D promotion boundary (Phase C/D pilot gates)
type: ai-coding-rule
appliesTo:
  - sekb-hermes-tier-d-promotion-decision
  - sekb-hermes-phase-c-would-trigger
  - sekb-hermes-phase-d-active-pilot
requiredProfiles:
  - fast
---

# Boundary: SEKB Hermes Tier D (Phase C/D)

## Authority split

- Offline `evaluable_for_promotion=true` is **not** production filtering and is
  **not** permission to mutate runtime by itself.
- Offline artifacts under `artifacts/sekb-hermes-phase-a5/**` must never drive
  runtime decisions.
- `confirm_and_save` remains the only durable L2 principle write path unless a
  brand-new approved task explicitly replaces that boundary.

## Entry gates

- Do **not** implement D1 (Phase C would_trigger) or D2 (active pilot) unless
  Tier C hard gates are all green **and** product/tech written approval for
  that stage exists.
- Automated smoke labels (`labelAuthority=automated_smoke_not_human`) cannot
  authorize promotion or gate brushing.

## Layer discipline

- **D0**: decision package / specs only; no runtime mutation.
- **D1**: mutation-free evidence only (`would_trigger`); no trajectory /
  principle / candidate-pool durable mutation; default-off + kill switch;
  named owner; workspace isolation; single-flight/lease; timeout cancel;
  observability.
- **D2**: minimal pilot only after D0+D1 evidence + separate approval;
  preferred surface is operator ranking / candidate priority; capture filter
  only if explicitly named and approved; still default-off; flag-off parity;
  one-flag rollback without reverse migration or data cleanup.

## Forbidden

- Full default-on filtering from Tier D tasks
- Shadow V1 holdout retune (threshold frozen at 50; algorithmic change requires
  Shadow V2 + fresh holdout)
- Silent deletion of user data based on shadow score
- Automatic principle / ContextBlock durable writes from shadow score
- Changing task success, permission, or retry authority
- SEKB ops GUI unless a new approved task explicitly adds it
