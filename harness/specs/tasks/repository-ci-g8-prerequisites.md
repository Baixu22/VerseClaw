---
lifecycleStatus: active
id: repository-ci-g8-prerequisites
title: Repair repository CI prerequisites for the G8 integration
taskType: repository-maintenance
diffBase: 42ad5e0b223d935e57630eb20c3501640721bf2e
intent: Restore explicit lifecycle metadata for three existing task contracts before accepting the G8 candidate.
touchedAreas:
  - harness/specs/tasks/audit-wiring-quick-fixes.md
  - harness/specs/tasks/audit-wiring-remainder.md
  - harness/specs/tasks/committed-branch-integration-20261109.md
  - harness/specs/tasks/repository-ci-g8-prerequisites.md
requiredRules:
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
requiredTests:
  - pnpm exec vitest run tests/unit/harness-spec-lifecycle.test.ts
  - pnpm harness:specs:lifecycle
  - pnpm run harness:ci
acceptance:
  - Every checked-in task spec declares a valid lifecycle status.
  - Preserve the three task contracts and acceptance criteria while declaring them active.
  - Record the maintenance delta separately from the G8 UI ownership report and run the complete repository Harness CI on the integrated clean candidate.
---

The three contracts retain their existing task owners. The lifecycle field makes
their current applicability explicit; their task completion remains governed by
their original acceptance evidence. This prerequisite commit is validated against
its own parent, and the G8 comparison starts from this prerequisite.
