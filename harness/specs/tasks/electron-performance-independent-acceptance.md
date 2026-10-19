---
lifecycleStatus: active
id: electron-performance-independent-acceptance
title: Independent Electron performance acceptance for TF-0421
type: task
intent: Independently re-read the committed instrumentation, startup, blocking-I/O, software-rendering and session-loading evidence, recompute its key facts, and record measured versus unmeasured boundaries without changing product defaults.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - harness/specs/tasks/electron-performance-independent-acceptance.md
  - harness/specs/fixtures/tf0421-independent-acceptance/**
---

# TF-0421 Independent Electron Performance Acceptance

## Objective

Audit the Electron performance work as a reviewer, not as the implementer: bind
the conclusion to the candidate commit, verify evidence files and checksums on
disk, recompute the headline metrics, and retain explicit boundaries.

## Acceptance

- Candidate ancestry and the private remote tip are recorded.
- TF-0417/0418/0419/0420/0423 evidence manifests verify against current bytes.
- Startup, blocking-I/O, renderer long-task, session request and screenshot
  facts are recomputed from raw JSON rather than copied from command output.
- The final report separates measured, unmeasured, declined and residual-risk
  scope, and records `driven_by: agent`.
- No product lock, frozen default or release path changes.