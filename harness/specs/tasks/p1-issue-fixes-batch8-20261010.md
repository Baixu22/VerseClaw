---
id: p1-issue-fixes-batch8-20261010
title: P1 issue batch 8 - active documentation path hygiene and artifact coverage
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close P1 issue #69 for active docs and record the verified #74 artifact-policy coverage.
expectedUserBehavior:
  - AGENTS.md and docs/**/*.md no longer contain developer-local absolute paths.
  - A CI gate rejects new developer-local paths in active documentation.
  - The repository artifact policy covers artifacts/ as reviewed/local content and the check remains green.
touchedAreas:
  - .gitignore
  - .github/workflows/**
  - AGENTS.md
  - docs/**
  - package.json
  - scripts/**
  - tests/**
  - harness/specs/tasks/p1-issue-fixes-batch8-20261010.md
  - docs/dev/p1-issue-fixes-batch8-20261010.md
requiredRules:
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node scripts/check-local-paths.mjs
  - node scripts/check-repository-artifacts.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/local-path-docs.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch8-20261010.md
acceptance:
  - Issue #69 - all 20 active AGENTS.md/docs files previously carrying %USERPROFILE% absolute paths were rewritten; the active-doc guard passes.
  - Issue #74 - artifacts/ is included in reviewedDirectories and repository artifact retention passes with zero shadow-tracking findings.
  - Historical artifacts/reports/plans are not rewritten as evidence.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch8-20261010.md
---

# P1 issue batch 8

This batch fixes active documentation path portability and records the
repository-artifact policy coverage that closes the shadow-tracking root cause
without rewriting historical evidence.
