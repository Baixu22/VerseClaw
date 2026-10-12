---
id: p3-issue-169-report-errata-20261012
title: P3 issue 169 - correct Windows runtime-efficiency report errata
lifecycleStatus: active
type: task
intent: Close P3 issue #169 by retaining an agent-driven errata index for four factual deviations in the Windows runtime-efficiency report, while preserving #162's current wiring truth and leaving #168 deferred capabilities untouched.
touchedAreas:
  - docs/dev/windows-runtime-efficiency-report-errata-20261012.md
  - docs/dev/p3-issue-169-20261012.md
  - docs/dev/p3-issue-169-20261012/acceptance.json
  - docs/dev/p3-issue-169-20261012/SHA256SUMS
  - docs/dev/windows-runtime-efficiency-observability.md
  - harness/specs/tasks/p3-issue-169-report-errata-20261012.md
  - scripts/repository-artifacts.json
  - .gitignore
expectedUserBehavior:
  - A reader is told which report coordinates were wrong, removed, or stale before relying on the report.
  - The report is not reused to claim resource leases are currently unwired after #162.
  - The deferred #168 index remains an index, not an implementation authorization.
requiredProfiles:
  - fast
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p3-issue-169-report-errata-20261012.md --no-diff
  - node scripts/check-spec-lifecycle.mjs
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-evidence-refs.mjs
  - node scripts/check-local-paths.mjs
acceptance:
  - The durable errata records all four #169 deviations: removed runtime lease path, post-report wiring change, two corrected file coordinates, and observationMasking default wording.
  - The corrected path coordinates resolve on the verified base, while the three removed/misnamed coordinates do not.
  - The errata explicitly says electron/services/resource-leases.ts was unwired at the report base but is wired into Main terminal.run by issue #162 on current main.
  - The change is documentation-only and does not alter product source, runtime behavior, host-api contract, permission default, product lock or frozen default.
  - Verification is agent-driven (driven_by: agent); no human verdict, human data, paid provider call or real-model evaluation is claimed.
docs:
  required: true
  paths:
    - docs/dev/windows-runtime-efficiency-report-errata-20261012.md
---

# P3 issue 169

This task closes the documentation truth-alignment issue created from the
Windows runtime-efficiency research report. It does not modify the report's
implementation conclusions or implement the deferred capabilities tracked by
#168.

The correction source is
`docs/dev/windows-runtime-efficiency-report-errata-20261012.md`. The tracked
acceptance summary is `docs/dev/p3-issue-169-20261012/acceptance.json`.