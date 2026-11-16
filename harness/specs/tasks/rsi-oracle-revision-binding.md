---
lifecycleStatus: active
id: rsi-oracle-revision-binding
title: Bind RSI live oracles to historical reference revisions
intent: Make every live task calibration restore its hidden tests from the historical reference revision, expose runtime/support dependencies deterministically, and retain an independently recomputable admission pack instead of grading mutable current working-tree tests.
diffBase: 5accfbddb
touchedAreas:
  - scripts/lib/rsi-live-grader.mjs
  - scripts/lib/rsi-live-grader.d.mts
  - scripts/rsi-live-acceptance.mjs
  - scripts/rsi-live-acceptance.d.mts
  - scripts/lib/rsi-benefit-eval.mjs
  - tests/unit/rsi-live-grader.test.ts
  - tests/unit/rsi-live-acceptance.test.ts
  - tests/unit/rsi-benefit-eval.test.ts
  - harness/specs/tasks/rsi-oracle-revision-binding.md
  - harness/specs/fixtures/rsi-live-acceptance/version-bound-cohort-20261106-v6/**
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
expectedUserBehavior:
  - A mutated current working-tree test file never changes the hidden oracle used for a historical task.
  - Root Vitest commands that import runtime source can resolve the runtime and package-local dependencies needed by that source.
  - Missing support packages fail closed or are disclosed with the exact resolved version.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/rsi-live-grader.test.ts tests/unit/rsi-live-acceptance.test.ts tests/unit/rsi-benefit-eval.test.ts --maxWorkers=1
  - node scripts/rsi-live-acceptance.mjs check --run-dir harness/specs/fixtures/rsi-live-acceptance/version-bound-cohort-20261106-v6
  - pnpm harness validate --spec harness/specs/tasks/rsi-oracle-revision-binding.md --no-diff
  - git diff --check
acceptance:
  - `resolveHistoricalTask` derives an oracle revision from the historical reference commit and records reference-time test digests.
  - Both reference and baseline stages restore the same frozen test bytes and `finalizeLiveAdmission` rejects missing or mismatched revision/digest fields.
  - Runtime dependencies are linked for every Vitest oracle, and the `markdown-it` support package is linked into the markdown-core package-local node_modules when required.
  - The v6 pack records 24 calibrated tasks, 21 admitted, 3 baseline-already-passes rejections and 216 not-run slots; `check` passes as `NO_GO`.
  - The support package version mismatch is disclosed in `oracle-binding.v1.json`; no product lock, approval, real-human, benefit or release claim changes.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# Reference-bound oracle admission

Historical acceptance records provide both a base and a reference revision. The
oracle test files must come from the reference revision, not from the mutable
current checkout. Otherwise a repository test change can silently turn an old
reference solution into an apparent model or task failure.

The live grader now records the reference revision and reference-time test
digests in every stage. Final admission recomputation re-reads those Git blobs
and fails closed on revision or digest drift. Runtime dependencies and declared
oracle support packages are linked in isolated workspaces so a dependency-only
failure remains infrastructure, not a task outcome.

The v6 readback at
`harness/specs/fixtures/rsi-live-acceptance/version-bound-cohort-20261106-v6/`
is still `NO_GO`: 21 tasks admit, while S03, L01 and L03 already pass at their
historical base and need a new unresolved start. The 216 model slots remain
unexecuted.
