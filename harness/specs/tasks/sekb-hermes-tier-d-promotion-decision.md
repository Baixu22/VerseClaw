---
lifecycleStatus: archived
id: sekb-hermes-tier-d-promotion-decision
title: "SEKB Hermes Tier D0: promotion decision package (no runtime mutation)"
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: |
  Produce the Tier D0 promotion decision package only: validate Tier C human
  dual-review hard gates, name the first conditional promotion object
  (operator ranking), document non-goals, rollback, monitoring, and Shadow V2
  rules. Do not implement Phase C/D runtime mutation. Do not claim production
  filtering. evaluable_for_promotion is offline evidence only.
ownedPaths:
  - artifacts/sekb-hermes-phase-a5/tier-d/**
  - harness/specs/tasks/sekb-hermes-tier-d-promotion-decision.md
  - harness/specs/rules/sekb-hermes-tier-d-boundary.md
  - harness/specs/tasks/sekb-hermes-phase-c-would-trigger.md
  - harness/specs/tasks/sekb-hermes-phase-d-active-pilot.md
  - harness/specs/rules/sekb-hermes-promotion-boundary.md
  - docs/enhancements/sekb-hermes-inspired-optimization-design.md
  - artifacts/sekb-hermes-phase-a5/CAMPAIGN.md
touchedAreas:
  - artifacts/sekb-hermes-phase-a5/tier-d/**
  - artifacts/sekb-hermes-phase-a5/CAMPAIGN.md
  - artifacts/sekb-hermes-phase-a5/PRODUCTION-ENABLEMENT-PRECONDITIONS.md
  - harness/specs/tasks/sekb-hermes-tier-d-promotion-decision.md
  - harness/specs/tasks/sekb-hermes-phase-c-would-trigger.md
  - harness/specs/tasks/sekb-hermes-phase-d-active-pilot.md
  - harness/specs/rules/sekb-hermes-tier-d-boundary.md
  - harness/specs/rules/sekb-hermes-promotion-boundary.md
  - docs/enhancements/sekb-hermes-inspired-optimization-design.md
expectedUserBehavior:
  - Operators read D0 pack and understand D1/D2 are blocked until Tier C green.
  - No user-facing runtime behavior changes from D0 alone.
  - Offline artifacts remain non-authoritative for runtime decisions.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - sekb-hermes-tier-d-boundary
  - sekb-hermes-promotion-boundary
  - sekb-hermes-default-off-boundary
  - sekb-hermes-write-path-boundary
forbiddenPatterns:
  - Phase C scheduler activation
  - Phase D capture filtering activation
  - runtime mutation from D0
  - treating evaluable_for_promotion as live filtering
  - Shadow V1 holdout retune
  - automated_smoke labels authorizing promotion
  - offline artifact runtime authority
  - confirm_and_save bypass
  - SEKB ops GUI
  - default-on SEKB filtering
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/sekb-hermes-tier-d-promotion-decision.md --no-diff
acceptance:
  - D0 decision pack exists under artifacts/sekb-hermes-phase-a5/tier-d/.
  - Tier C gate audit recorded with actual dual-review counts and evaluable_for_promotion=false when incomplete.
  - First promotion object is operator ranking / candidate priority, not full filter.
  - Non-goals, rollback (single flag, no reverse migration), monitoring fields, and Shadow V2 rule are documented.
  - D1/D2 task drafts exist but mark implementation blocked until Tier C hard gates + written approval.
  - Package explicitly states evaluable_for_promotion is not production filtering.
  - No Phase C/D runtime code lands under this task alone.
docs:
  required: true
  note: Update design status and campaign notes; do not claim production enablement.
---

# SEKB Hermes Tier D0  -  Promotion Decision

Machine-readable entry for the **decision package only**. Implementation of
Phase C (`would_trigger`) or Phase D (active pilot) requires **separate**
approved task specs **after** Tier C hard gates are green.

## Binding control pack

- `artifacts/sekb-hermes-phase-a5/tier-d/D0-PROMOTION-DECISION-PACK.md`
- `artifacts/sekb-hermes-phase-a5/tier-d/promotion-decision.v1.json`
- `harness/specs/rules/sekb-hermes-tier-d-boundary.md`
- `artifacts/sekb-hermes-phase-a5/tier-c/GO-NO-GO.md`
- `artifacts/sekb-hermes-phase-a5/PRODUCTION-ENABLEMENT-PRECONDITIONS.md`

## Gate rule

If any of the following is false, **stop before D1/D2 code**:

1. `independentlyReviewedTrajectories >= 200` with human dual-review authority
2. unresolved disagreements == 0 after adjudication
3. Cohen's kappa >= 0.7
4. holdout valuable recall >= 0.95 under frozen Shadow V1@50 (no retune)
5. holdout projected false-drop <= 0.02
6. product/tech written approval for the next stage

## Layering

| Layer | Deliverable | Runtime mutation |
| --- | --- | --- |
| D0 | decision pack + drafts | **none** |
| D1 | Phase C would_trigger evidence | none durable |
| D2 | active pilot (ranking preferred) | minimal, default-off |

## Validation

```powershell
pnpm harness validate --spec harness/specs/tasks/sekb-hermes-tier-d-promotion-decision.md --no-diff
```
