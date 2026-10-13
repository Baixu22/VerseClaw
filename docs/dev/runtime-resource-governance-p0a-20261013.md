# Runtime Resource Governance P0A

Status: implemented and locally verified on 2026-10-13 (agent-driven).

Issue: #213 Work Package A (P0 correctness gap).

## Problem closed

The planner already produced write-set-aware `executionWaves`, but the production
orchestration path recomputed execution waves with a scheduler that only checked
exclusive tools. As a result, disjoint writers could be over-serialized while
intersecting writers could still be co-scheduled, and `isolation=worktree` existed
only as plan metadata.

## Changes

- `scheduleResourceAwareWaves` now consumes write-set proof before exclusive-tool
  contention:
  - intersecting shared write sets are split;
  - proven-disjoint write sets can share a wave even when both roles have `write`;
  - custom-role write sets are checked even when the role does not declare the
    built-in write tools;
  - missing write sets for writer-capable nodes force single-writer waves and
    record `insufficient-writeSet-proof`.
- Production orchestration now overwrites the returned plan's `executionWaves`
  with the exact waves it executes, so plan and execution cannot drift.
- `isolation=worktree` now creates a worktree through the existing worktree
  service, seeds the declared write set for the inprocess backend, passes the
  worktree root as the child `cwd`, and records worktree id/backend/write-set
  metadata.
- Completed isolated workers are merged through the existing merge queue when all
  expected workers have ended. Merge status, conflict reason, and declared-vs-actual
  drift (when git status is available) are persisted on orchestration metadata.
- Added `listChangedFiles`/batched merge filtering to the worktree service.

## Scope boundary

This change closes only Work Package A. Work Packages B-D of #213 (unified
Resource Envelope/admission, shed consumers, resource sampling, end-to-end stress
benchmarks) remain open and are not claimed by this change set.

No product lock, frozen default, permission default, external telemetry path, or
worktree backend default was changed. `isolation` remains opt-in; shared mode
remains the default.

## Verification evidence

Executed in the D: worktree on the issue branch:

- `pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/role-spawn.test.ts tests/unit/orchestration-worktree-merge.test.ts` -> 3 files / 32 tests passed.
- `pnpm exec vitest run --config vitest.config.ts src/agents/worktree-service.test.ts src/agents/orchestrator-write-set-plan.test.ts src/agents/orchestration-write-set.test.ts` (from `openclaw_runtime`) -> 3 files / 29 tests passed.
- `pnpm exec vitest run ...` orchestration regression set -> 11 files / 121 tests passed.
- `pnpm run typecheck` -> success, 0 errors in node/web/test projects.
- `pnpm run comms:replay` -> wrote `artifacts/comms/current-metrics.json`.
- `pnpm run comms:compare` -> PASS; all comms metrics within thresholds.
- `pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0a-20261013.md --no-diff` -> Spec is valid.

All evidence is agent-generated. No real-human evidence is claimed.