---
lifecycleStatus: archived
id: sekb-hermes-phase-d-active-pilot
title: "SEKB Hermes Phase D (D2): minimal active pilot (default-off)"
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: "DRAFT/BLOCKED until D0+D1 evidence and separate product/tech approval. Minimal active pilot only; preferred surface is operator review ranking / candidate priority. Narrow capture filter only if explicitly approved. Default-off, flag-off parity, one-flag rollback, no data cleanup. Forbidden silent user-data delete by shadow score, auto principle write, full production filtering, GUI ops console unless new spec."
status: blocked_draft
implementationAuthorized: false
blockedUntil:
  - d0_decision_pack_complete
  - d1_would_trigger_evidence_sufficient
  - product_tech_written_approval_d2
  - fresh_holdout_retest_plan
ownedPaths:
  - harness/specs/tasks/sekb-hermes-phase-d-active-pilot.md
  - harness/specs/rules/sekb-hermes-tier-d-boundary.md
  - artifacts/sekb-hermes-phase-a5/tier-d/**
touchedAreas:
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/config/**
  - electron/services/knowledge-api.ts
  - scripts/sekb-*.mjs
  - tests/**
  - harness/specs/tasks/sekb-hermes-phase-d-active-pilot.md
  - artifacts/sekb-hermes-phase-a5/tier-d/**
expectedUserBehavior:
  - Default path unchanged when pilot flag is off.
  - When ranking pilot is on, operator candidate order may change; store contents do not silently delete.
  - confirm_and_save remains the only durable L2 write path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - sekb-hermes-tier-d-boundary
  - sekb-hermes-promotion-boundary
  - sekb-hermes-default-off-boundary
  - sekb-hermes-write-path-boundary
forbiddenPatterns:
  - full production filtering
  - default-on pilot
  - silent user data delete by shadow score
  - automatic principle writes
  - offline artifact runtime authority
  - Shadow V1 holdout retune
  - confirm_and_save bypass
  - SEKB ops GUI without new spec
  - changing task success permission or retry authority
  - implementation before D0+D1+approval
featureFlags:
  - D2 pilot uses a dedicated default-off flag separate from D1 would_trigger, master SEKB, shadow evaluation, and batch flags.
  - Kill switch restores pre-pilot ordering/filter behavior without migration.
rollback:
  - Single flag off; no reverse migration; no data cleanup required.
  - Rollback drill recorded under artifacts/sekb-hermes-phase-a5/tier-d/ROLLBACK-DRILL.md.
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/sekb-hermes-phase-d-active-pilot.md --no-diff
  - flag-off parity tests
  - focused pilot surface tests
  - rollback drill evidence
acceptance:
  - Preflight proves D0+D1 + written D2 approval + named pilot surface, or task stays draft-only.
  - Pilot flag defaults off.
  - Preferred surface is operator ranking; filter only if explicitly approved in the same sign-off.
  - Fresh holdout valuable recall / false-drop retested (no V1 holdout retune).
  - Monitoring fields for false-drop, complaints, latency documented (CLI/report OK).
  - Rollback drill pass recorded.
  - Package still states evaluable_for_promotion is not production filtering.
docs:
  required: true
  note: Never announce full production filtering from this pilot task.
---

# SEKB Hermes Phase D (D2) - Active Pilot (DRAFT / BLOCKED)

## Current authorization

**implementationAuthorized: false**

Blocked by incomplete Tier C and missing D1 evidence/approvals (see D0 pack).

## Preferred pilot surface

**Operator review ranking / distillation candidate priority**

- Reorders operator-facing candidates only
- Does not delete trajectories
- Does not write principles

## Optional later surface (requires explicit naming in approval)

Extremely narrow capture filter for an opt-in pilot cohort only. Still
default-off. Still not full production filtering.

## Pass gates when authorized

1. Fresh holdout retest: valuable recall / false-drop within policy
2. Flag-off parity
3. Rollback drill pass
4. Monitoring live (CLI/report sufficient)

## Hard bans

- Shadow-score silent user data delete
- Auto principle write
- Full default-on filtering
- GUI-wide ops console without new approved spec