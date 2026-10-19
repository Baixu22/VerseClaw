---
lifecycleStatus: active
id: electron-v8-snapshot-decision
title: Electron V8 snapshot decision for TF-0422
type: task
intent: Decide whether a custom Electron V8 snapshot belongs in the build chain by combining same-version local startup evidence with official Electron and electron-builder constraints, without changing product defaults or release paths.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - harness/specs/tasks/electron-v8-snapshot-decision.md
  - harness/specs/fixtures/tf0422-v8-snapshot-decision/**
---

# TF-0422 V8 Snapshot Decision

## Objective

Record an explicit implement-or-reject decision for a custom main-process V8
snapshot, with same-version Electron startup evidence, platform/ABI risks,
rollback cost and conditions that would justify reopening the decision.

## Acceptance

- The local Electron version and builder version are recorded.
- External findings cite Electron fuses, mksnapshot and the missing-snapshot
  packaging failure mode.
- The report separates the unmeasured snapshot benefit from the measured
  stock-startup baseline; no blog percentage is substituted.
- Windows/macOS/Linux and x64/arm64 risks, ABI/content constraints and rollback
  path are recorded.
- The decision does not modify a frozen default, product lock or release path.