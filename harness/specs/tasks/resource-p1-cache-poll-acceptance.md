---
lifecycleStatus: active
id: resource-p1-cache-poll-acceptance
title: Resource Fabric P1 independent acceptance (TF-0407)
type: task
intent: Independently verify the P1 cache and polling takeover with a pre-P1/P1 controlled read benchmark, while retaining pure-idle counter-evidence that does not support a reduction claim.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - harness/specs/tasks/resource-p1-cache-poll-acceptance.md
  - harness/specs/fixtures/tf0407-p1-acceptance/**
---

# TF-0407 P1 Independent Acceptance

## Objective

Verify the P1 cache and polling work against the landed TF-0405 implementation
without inventing a spawn reduction from a workload that never repeats the
cached read.

## Acceptance

- The controlled pre-P1/P1 five-minute read benchmark uses the same probe,
  Electron flags, seeded workspace, and runtime counter.
- The controlled read-path spawn reduction is at least 80%.
- The pure-idle before/after counter pair is retained even though it shows the
  same seven startup spawns and therefore does not support a reduction claim.
- The same-key concurrency test and the required project gates pass.
- Evidence is agent-driven and explicitly labels the pure-idle limitation.
