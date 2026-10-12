---
id: p3-issue-168-deferred-index-20261012
title: P3 issue 168 - retain deferred Windows runtime capability index
lifecycleStatus: completed
type: task
intent: Close issue #168 as a documentation-only deferred index by recording the verified boundaries and reopen triggers for Job-object kernel readback, CPU rate limiting, and long-window FD/RSS measurement, without implementing any of the three.
touchedAreas:
  - docs/dev/p3-issue-168-deferred-capabilities-20261012.md
  - docs/dev/p3-issue-168-20261012.md
  - docs/dev/p3-issue-168-20261012/acceptance.json
  - docs/dev/p3-issue-168-20261012/SHA256SUMS
  - docs/dev/windows-runtime-efficiency-observability.md
  - harness/specs/tasks/p3-issue-168-deferred-index-20261012.md
  - scripts/repository-artifacts.json
  - .gitignore
expectedUserBehavior:
  - The three deferred capabilities have one durable place to cite, with explicit trigger conditions for reopening.
  - The index does not present the deferred capabilities as implemented or currently required.
  - A later audit can distinguish missing kernel readback from a failure to apply the declared limits.
requiredProfiles:
  - fast
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p3-issue-168-deferred-index-20261012.md --no-diff
  - node scripts/check-spec-lifecycle.mjs
  - node scripts/check-evidence-refs.mjs
  - node scripts/check-local-paths.mjs
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - The durable index records all three #168 items and their triggers: kernel readback, CPU rate limiting, and FD/RSS long-window measurement.
  - The index cites current source/doc coordinates and keeps each item explicitly deferred or out of scope.
  - No product source, runtime behavior, host-api contract, permission default, product lock or frozen default changes.
  - Verification is agent-driven (driven_by: agent); no human verdict, human data, paid provider call or real-model evaluation is claimed.
docs:
  required: true
  paths:
    - docs/dev/p3-issue-168-deferred-capabilities-20261012.md
---

# P3 issue 168

This task closes the documentation/index disposition of #168. The three
capabilities remain deferred; they are not implemented or enabled by this
change.

The durable index is
`docs/dev/p3-issue-168-deferred-capabilities-20261012.md`. Acceptance evidence
is `docs/dev/p3-issue-168-20261012/acceptance.json`.