---
lifecycleStatus: active
id: rsi-model-smoke-admission
title: Run a white-box model smoke and admit target-scoped missing baselines
intent: Validate the real Responses/model execution path on one historical task while distinguishing an expected missing target implementation from an unrelated missing dependency, without treating the smoke as RSI benefit evidence.
diffBase: 6bd094f1e
touchedAreas:
  - scripts/lib/rsi-live-grader.mjs
  - scripts/lib/rsi-live-grader.d.mts
  - scripts/rsi-live-acceptance.mjs
  - scripts/rsi-live-acceptance.d.mts
  - tests/unit/rsi-live-acceptance.test.ts
  - tests/unit/rsi-live-grader.test.ts
  - harness/specs/tasks/rsi-live-acceptance.md
  - harness/specs/tasks/rsi-model-smoke-admission.md
  - harness/specs/fixtures/rsi-model-diagnostic/**
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
  - An expected missing module inside a task's declared target scope is recorded as a baseline warning instead of an unrelated infrastructure failure.
  - A missing module outside target scope remains a hard admission failure.
  - One real space-bunny task smoke can exercise the provider, edit application and oracle path without being counted as a 216-slot benefit trial.
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-live-acceptance.test.ts tests/unit/rsi-live-grader.test.ts --maxWorkers=1
  - node scripts/rsi-live-acceptance.mjs calibrate --run-dir D:/tmp/rsi-model-test-20261105-v2 --task-id tf-0291-g03 --timeout-ms 180000
  - node scripts/rsi-live-acceptance.mjs calibrate --run-dir D:/tmp/rsi-model-test-20261105-v2 --task-id tf-0284-l02 --timeout-ms 180000
  - pnpm harness validate --spec harness/specs/tasks/rsi-model-smoke-admission.md
  - git diff --check
acceptance:
  - Missing-module diagnostics read the top-level Vitest suite message as well as assertion failure messages.
  - The target-scope check normalizes JS/TS extension pairs and remains false for a dependency outside target scope.
  - G03 and L02 calibrate with reference pass, baseline not pass, and `baseline-target-module-absent` warning.
  - A live space-bunny G03 smoke produces only target-scope edits, leaves the oracle unchanged, and passes 6/6 tests.
  - The smoke is explicitly white-box and not benefit eligible because only one task is run, no k=3/216 plan is executed, and a public interface contract derived from the task contract was supplied.
  - No product default, product lock, approval, permission, real-human claim or benefit claim changes.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# RSI model smoke and admission refinement

This is a diagnostic and admission-layer change. The model smoke proves that the
local Responses endpoint, edit application and independent oracle can execute one
historical task. It is not a blind benchmark and not an RSI benefit trial.