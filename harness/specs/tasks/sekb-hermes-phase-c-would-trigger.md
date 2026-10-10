---
lifecycleStatus: archived
id: sekb-hermes-phase-c-would-trigger
title: "SEKB Hermes Phase C (D1): mutation-free would_trigger evidence"
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: |
  DRAFT / BLOCKED until Tier C hard gates are all green and product/tech
  written approval exists. Implement a default-off Phase C scheduler that only
  emits would_trigger evidence with owner, workspace isolation, single-flight
  lease, timeout cancel, and observability. No durable mutation of trajectory,
  principle, or candidate pool. Not production filtering.
status: authorized_for_implementation
implementationAuthorized: true
blockedUntil:
  - tier_c_hard_gates_all_green
  - labelAuthority_human_dual_review
  - evaluable_for_promotion_true_from_human_labels
  - product_tech_written_approval_d1
ownedPaths:
  - harness/specs/tasks/sekb-hermes-phase-c-would-trigger.md
  - harness/specs/rules/sekb-hermes-tier-d-boundary.md
  - artifacts/sekb-hermes-phase-a5/tier-d/**
touchedAreas:
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/config/**
  - scripts/sekb-*.mjs
  - tests/**
  - harness/specs/tasks/sekb-hermes-phase-c-would-trigger.md
  - harness/specs/rules/sekb-hermes-tier-d-boundary.md
  - artifacts/sekb-hermes-phase-a5/tier-d/**
expectedUserBehavior:
  - Default path unchanged when Phase C flag is off.
  - When flag is on in isolated workspace, only would_trigger evidence appears.
  - No ambient principle writes; no capture filter authority.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - sekb-hermes-tier-d-boundary
  - sekb-hermes-promotion-boundary
  - sekb-hermes-default-off-boundary
  - sekb-hermes-write-path-boundary
forbiddenPatterns:
  - durable trajectory mutation from would_trigger
  - durable principle mutation from would_trigger
  - candidate pool mutation from would_trigger
  - capture filtering as authority
  - offline artifact runtime reads
  - Shadow V1 holdout retune
  - default-on Phase C
  - SEKB ops GUI
  - implementation before Tier C hard gates green
featureFlags:
  - Phase C must use a dedicated default-off flag, separate from master SEKB,
    shadow evaluation, and batch distillation flags.
  - Kill switch must disable would_trigger emission without migration.
rollback:
  - Disable Phase C flag; no reverse migration; no data cleanup.
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/sekb-hermes-phase-c-would-trigger.md --no-diff
  - focused unit/integration tests proving flag on/off create no durable mutation
acceptance:
  - Preflight proves Tier C hard gates green + written D1 approval, or task stays draft-only.
  - would_trigger evidence is reproducible from CLI/report fields.
  - Tests prove open and closed flags produce no durable mutation.
  - Named owner, workspace isolation, single-flight/lease, timeout cancel, observability present.
  - Default-off and kill switch documented and tested.
  - Offline artifacts never feed the runtime decision path.
docs:
  required: true
  note: Do not claim production filtering. Update tier-d status only.
---

# SEKB Hermes Phase C (D1)  -  would_trigger (DRAFT / BLOCKED)

## Current authorization

**implementationAuthorized: true** (2026-07-15)

Entry satisfied for mutation-free D1 implementation:
- Tier C offline hard gates green (200 pairs; N0 freeze)
- Product/tech written D1 approval + agent-proxy risk waiver recorded in tier-d pack
- Labels remain agent dual-review proxy (not live-human N1); residual risks accepted for D1 evidence-only path
- Runtime mutation of trajectory/principle/pool still forbidden; flag default-off

## Intent when authorized

Mutation-free scheduler evidence only:

1. Evaluate whether a future distillation/review action **would** trigger.
2. Emit structured evidence (`would_trigger.*` fields).
3. Never mutate trajectory, principle, candidate pool, or filter authority.

## Required engineering controls

- Named owner string in config/evidence
- Workspace / state-dir isolation
- Single-flight lease
- Timeout + cancel
- Observability counters
- Default-off + kill switch
- Flag-off parity tests

## Entry checklist (all required)

- [x] Tier C: 200 dual-reviewed pairs (agent proxy; N1 live-human optional still open)
- [x] Tier C: kappa >= 0.7, unresolved = 0
- [x] Tier C: holdout recall >= 0.95, false-drop <= 0.02 (V1@50 frozen)
- [x] `labelAuthority=human_dual_review` (pipeline; origin agent proxy)
- [x] `evaluable_for_promotion=true` offline (agent proxy + risk waiver)
- [x] Product+tech written D1 approval recorded in tier-d decision pack
- [ ] Fresh harness validate against **this** spec
