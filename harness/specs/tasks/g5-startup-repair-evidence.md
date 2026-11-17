---
lifecycleStatus: completed
id: g5-startup-repair-evidence
title: Retain G5 startup repair evidence with candidate-specific outcomes
taskType: documentation
diffBase: 7fee8fab78bccd60624ee458c4fd278a645b5853
intent: Preserve the verified startup repairs, exact candidate identities and remaining integration failures in a compact durable report.
ownedPaths:
  - harness/specs/tasks/g5-startup-repair-evidence.md
  - harness/specs/fixtures/g5-startup-repairs/20261117/REPORT.md
  - harness/specs/fixtures/g5-startup-repairs/20261117/report.json
  - harness/specs/fixtures/g5-startup-repairs/20261117/manifest.json
touchedAreas:
  - harness/specs/tasks/g5-startup-repair-evidence.md
  - harness/specs/fixtures/g5-startup-repairs/20261117/**
requiredRules:
  - repository-artifact-retention
  - docs-sync
expectedUserBehavior:
  - Reviewers can distinguish verified fixes from incomplete phase and integration acceptance by candidate and receipt.
acceptance:
  - Report source hashes match Git blobs and local files, and the manifest matches both report files.
  - Historical, failed and environment-aborted measurements retain their original status and candidate identities.
  - Raw runs and Task Forest history remain in local private storage; only the concise final report is tracked.
requiredTests:
  - git diff --check
  - pnpm harness validate --spec harness/specs/tasks/g5-startup-repair-evidence.md
  - pnpm repo:artifacts:check
docs:
  required: true
  readmeTranslations: not-required
  reason: Candidate-specific validation report; product documentation was updated with the implementation.
  files:
    - harness/specs/fixtures/g5-startup-repairs/20261117/REPORT.md
---

This report records a completed repair and verification phase. TF-0665, TF-0867
and the G5 program retain their outstanding acceptance work.
