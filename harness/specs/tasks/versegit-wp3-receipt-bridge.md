---
lifecycleStatus: active
id: versegit-wp3-receipt-bridge
title: WP3 - bind VerseGit verification plans to host VerseShell receipts
scenario: versegit-validation-layer-extension
taskType: planning
intent: Implement a host-owned receipt bridge that binds immutable verification plans to execution-receipt bindings, rejects caller self-report and stale/wrong/duplicate receipts, and produces six-dimensional verdict facts without executing a process or promoting a structural fixture to live evidence.
touchedAreas:
  - harness/specs/tasks/versegit-wp3-receipt-bridge.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/fixtures/versegit-planning-correction/wp3-receipt-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp3-evidence/**
  - artifacts/versegit/wp3/**
  - artifacts/versegit-planning-correction/SHA256SUMS
  - electron/services/versegit-receipt-bridge.ts
  - scripts/versegit-wp3-receipts.mjs
  - scripts/verify-versegit-wp3.mjs
  - tests/unit/versegit-wp3-receipts.test.ts
expectedUserBehavior:
  - A VerseGit verification plan is immutable, digest-bound and carries candidate, check, owner, epoch, authorization and required-scope identity.
  - Only receipts declaring VerseShell host-process/artifact authority are consumable; caller self-report, wrong candidate, stale epoch, digest drift, selected-as-full, missing artifacts and duplicates are refused.
  - Missing or structural-only receipts produce `partial/unmeasured`, never a pass or live execution claim.
  - The bridge never invokes child processes, never executes a plan and never changes the host verdict.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp3-receipts.mjs --fixture harness/specs/fixtures/versegit-planning-correction/wp3-receipt-fixture.json --out artifacts/versegit/wp3/verdict.json
  - node scripts/verify-versegit-wp3.mjs --artifact artifacts/versegit/wp3/verdict.json
  - pnpm exec vitest run tests/unit/versegit-wp3-receipts.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp3-receipt-bridge.md
acceptance:
  - The plan binds all execution identity fields and its digest is reproducible.
  - A structurally valid VerseShell-authored fixture is accepted but yields only `partial/unmeasured` because it is not a live receipt.
  - Wrong candidate, stale epoch, plan/argv digest mismatch, missing artifacts, selected-scope-as-full, caller self-report and missing receipt are rejected; duplicate receipt is explicitly duplicate.
  - The bridge imports no process execution module, starts no process and keeps the host verdict unchanged and `single_green_light=false`.
  - Independent verifier replays the ten-case fixture, rejects live-execution claims and reproduces the artifact digest.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md
---

# WP3 host-owned receipt bridge

WP3 interprets execution receipts; it does not execute them. The fixture is deliberately
host-authored structural evidence, so its verdict remains `partial/unmeasured` until a
real VerseShell receipt is supplied by the host process/artifact authority.

## Binding

The plan includes run/candidate/check/owner/epoch/authorization and immutable command
argv/cwd/env digests. A receipt must bind every field, the full required scope, artifact
digests and clean cleanup state.

## Verdict facts

The six dimensions remain independent. Structural-only receipt evidence is
`normalized-event` and `unmeasured`; it cannot become `verified` or a host pass.