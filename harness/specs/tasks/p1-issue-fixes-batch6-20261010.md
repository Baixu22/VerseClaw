---
id: p1-issue-fixes-batch6-20261010
title: P1 issue batch 6 - dead switches, skipped-test visibility, evidence hashes and deep paths
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close P1 issues #70, #76, #93 and #95 by removing the dead uftk surface, reporting conditional skips, annotating historical evidence drift, and validating runtime deep paths.
expectedUserBehavior:
  - Retired runtime.coding.uftk switches are rejected instead of appearing as schema-valid but unwired capabilities.
  - Conditional DeepSeek suites report their skipped counts in CI, including the exact per-file counts.
  - Historical SHA256SUMS drift is explicit and verified through INTEGRITY.json annotations; unannotated drift fails.
  - Shared evidence refs and root package script paths into openclaw_runtime are checked for existence.
touchedAreas:
  - .github/workflows/**
  - .gitignore
  - artifacts/**
  - openclaw_runtime/src/config/**
  - package.json
  - scripts/**
  - tests/**
  - harness/specs/tasks/p1-issue-fixes-batch6-20261010.md
  - docs/dev/p1-issue-fixes-batch6-20261010.md
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node scripts/check-evidence-refs.mjs
  - node scripts/verify-evidence-sha256sums.mjs
  - node scripts/check-repository-artifacts.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/evidence-refs-exist.test.ts tests/unit/evidence-sha256sums.test.ts tests/unit/report-test-skips.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run src/config/runtime-coding-uftk.test.ts --maxWorkers=1
  - pnpm run test:skips:report
  - pnpm run typecheck
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch6-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Issue #95 - the entire runtime.coding.uftk block is removed from types, zod schema and exhaustive leaves; the schema test now rejects it.
  - Issue #76 - report-test-skips discovers hasDeepSeekKey suites dynamically and prints suite/passed/skipped counts; the CI check workflow runs it after the normal test step.
  - Issue #70 - committed evidence manifests with INTEGRITY.json annotations pass verification; missing files and unannotated hash drift fail. The two known historical snapshots are annotated with exact reasons.
  - Issue #93 - shared openclaw_runtime evidence paths and package.json runtime script paths are checked by check-evidence-refs; the version dual-track problem remains tracked separately as #67 and is not claimed fixed here.
  - Verification is local/static; remote CI execution and packaged release are not claimed.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch6-20261010.md
---

# P1 issue batch 6

This batch removes a false capability surface, makes conditional test skips
visible, adds a real evidence-hash verifier with historical annotations, and
extends deep-path validation to runtime scripts referenced from the root
package.
