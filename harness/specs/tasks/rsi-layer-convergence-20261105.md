---
lifecycleStatus: active
id: rsi-layer-convergence-20261105
title: Close RSI evidence-scope, source-identity and measured-receipt gaps
intent: Repair the remaining inconsistencies between the RSI decision readback, live task admission, frozen benefit plan and measured collector receipt without changing product defaults or claiming benefit.
diffBase: bfcf57616
touchedAreas:
  - scripts/rsi-decision-check.mjs
  - scripts/rsi-historical-task-corpus.mjs
  - scripts/rsi-live-acceptance.mjs
  - scripts/rsi-live-acceptance.d.mts
  - scripts/rsi-benefit-eval.mjs
  - scripts/lib/rsi-benefit-eval.*
  - tests/unit/rsi-decision-check.test.ts
  - tests/unit/rsi-historical-task-corpus.test.ts
  - tests/unit/rsi-live-acceptance.test.ts
  - tests/unit/rsi-benefit-eval.test.ts
  - harness/specs/tasks/rsi-benefit-eval.md
  - harness/specs/tasks/rsi-live-acceptance.md
  - harness/specs/tasks/rsi-layer-convergence-20261105.md
  - harness/specs/fixtures/rsi-evidence-loop/decision-implementation-validation.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/review-20261105.json
  - harness/specs/fixtures/agent-first-task-corpus/**
  - harness/specs/fixtures/rsi-live-acceptance/**
  - docs/dev/rsi-capability-and-boundaries.md
  - docs/dev/rsi-decision-implementation.md
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - paired-ablation-boundary
  - reliability-aggregation-boundary
expectedUserBehavior:
  - A parallel README edit does not invalidate RSI evidence, while RSI code, rules, fixtures and acceptance records still fail closed.
  - A measured benefit plan binds each task's source record, base/reference revisions, target scope and acceptance criteria before any receipt exists.
  - A measured receipt carries replayable edits and a grader bound to the base revision and edits digest; synthetic calibration cannot enter a measured run.
  - The live admission report becomes ready only when all 24 task calibrations and a matching successful provider preflight are retained.
  - The benefit plan imports the same live calibration package instead of requiring an unverified manual copy, and a dead-run lock can be recovered.
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-live-acceptance.test.ts tests/unit/rsi-decision-check.test.ts tests/unit/rsi-historical-task-corpus.test.ts tests/unit/evidence-binding.test.ts --maxWorkers=1
  - node scripts/rsi-decision-check.mjs --json
  - node scripts/rsi-historical-task-corpus.mjs --check
  - node scripts/rsi-live-acceptance.mjs check --run-dir harness/specs/fixtures/rsi-live-acceptance
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/rsi-layer-convergence-20261105.md
  - git diff --check
acceptance:
  - The decision readback records README hashes but classifies their drift as a warning, and a regression test proves a README-only change still passes.
  - TF-0590 records the RSI capability boundary document in its fingerprint but treats documentation drift as a warning; only corpus, grader, task-spec and oracle inputs invalidate the seal.
  - A plan records sourceRecord, recordDigest, base, reference, targetScope and acceptanceCriteria for all 24 tasks; source-record mutation invalidates validation.
  - Measured receipts reject missing schema, synthetic/invalid calibration, out-of-scope edits, hidden-oracle edits, edit digest drift, wrong workspace revision and a passing trial with no edit.
  - `calibrate` rejects a non-ready or drifted live admission report, copies the report, 24 admissions and provider preflight immutably, and re-running it is idempotent.
  - `ready-for-measurement` requires a passed provider preflight whose endpoint and model match the measured plan.
  - An empty measured pack reports null token and dollar cost, and a dead-process run lock is reclaimed without retrying a recorded trial.
  - The retained real-provider result remains NO_GO; 216 slots remain not-run; no benefit, default, product-lock or release claim changes.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
    - docs/dev/rsi-decision-implementation.md
readmeUpdates: not-required
---

# RSI layer convergence

This is evaluator maintenance under the existing RSI program. It closes
cross-layer contradictions found by a local second review: documentation scope,
task source identity, replayable edits, live admission consumption, provider
preflight consumption and stale-lock recovery. It does not implement a new
coding agent or promote SEKB. All generated evidence is agent-driven.