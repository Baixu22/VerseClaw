---
lifecycleStatus: active
id: versegit-module-planning-correction
title: VerseGit module planning correction and independent re-review
scenario: versegit-validation-layer-extension
taskType: planning
intent: Repair the VerseGit migration plan after the 2026-10-21 independent review returned FAIL, then require an independent re-review before any WP0/MC0 implementation work starts.
touchedAreas:
  - harness/specs/tasks/versegit-module-planning-correction.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/fixtures/versegit-planning-correction/**
  - scripts/validate-versegit-planning-correction.mjs
  - tests/unit/versegit-planning-correction.test.ts
  - harness/specs/guides/versegit-concurrency/**
  - harness/specs/rules/versegit-validation-layer-extension-boundary.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - docs/dev/versegit-validation-layer/README.md
  - .agent-workbench/task-forest/proposals/TFP-clawx-versegit-module-plan-review-20261021.json
expectedUserBehavior:
  - A future session sees exactly one ready node for this planning correction and cannot accidentally start WP0 or MC0 before the correction closes.
  - The planning guide, scenario, rule and Task Forest agree on the unified WP/MC DAG.
  - M1 diagnostic commands have a per-entry effect audit that proves whether they read, write, initialize, migrate, materialize, or execute.
  - The host cleanup barrier and execution receipt contract are defined before adapter implementation.
  - Every planning gap has either a concrete correction, a named follow-up node, or an explicit execution-only boundary.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/versegit-module-planning-correction.md
  - pnpm harness validate --spec harness/specs/tasks/versegit-module-planning-correction.md
  - node scripts/validate-versegit-planning-correction.mjs
  - pnpm exec vitest run tests/unit/versegit-planning-correction.test.ts
acceptance:
  - The independent review's P0-1, P0-2 and P0-3 findings have concrete on-disk corrections.
  - P1-1 through P1-8 are either corrected or converted into named follow-up nodes with explicit execution-only boundaries.
  - The Task Forest has a single unified DAG in which MC0, MC1, MC2, MC3 and MC5 gate the corresponding WP0-WP3 implementation nodes.
  - The M1 diagnostic surface has an effect matrix that distinguishes pure reads, domain-state writes, workspace writes, Git object writes, materialization, and command execution.
  - The host cleanup barrier defines stop, drain, evidence seal, detach, owner/epoch verification, and deletion order.
  - The execution receipt contract binds plan, candidate, check, owner, epoch, execution inputs, required scope, artifacts and cleanup, and rejects stale or mismatched receipts.
  - VG provider delivery has a source/build/binary digest contract and does not depend on a mutable checkout path.
  - The planning documents distinguish disposable resources from evidence that must be retained.
  - The correction ends with an independent re-review verdict of at least PASS_WITH_GAPS, with remaining gaps limited to execution-time validation.
  - The task spec passes full harness validation without --no-diff in a clean tree.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md
---

# VerseGit module planning correction

This is a planning-only work package. It does not implement the VerseGit adapter,
harness profile, VerseShell bridge, or any VerseGit source change.

The correction must finish before TF-0473/MC0 or TF-0466/WP0 can start.