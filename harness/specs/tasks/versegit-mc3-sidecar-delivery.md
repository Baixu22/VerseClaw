---
lifecycleStatus: active
id: versegit-mc3-sidecar-delivery
title: MC3 - freeze the digest-addressed VerseGit sidecar package
scenario: versegit-validation-layer-extension
taskType: planning
intent: Deliver VerseGit to ClawX as a digest-addressed sidecar package with verified startup, timeout, kill-switch and recovery behavior, without copying the VerseGit build tree or consuming a mutable checkout path.
touchedAreas:
  - harness/specs/tasks/versegit-mc3-sidecar-delivery.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/fixtures/versegit-planning-correction/mc3-delivery-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/mc3-evidence/**
  - scripts/versegit-mc3-delivery.mjs
  - scripts/verify-versegit-mc3.mjs
  - tests/unit/versegit-mc3-delivery.test.ts
expectedUserBehavior:
  - The package manifest names the effective source commit, tree, residual patches, build recipe, lockfile, platform, binary digest, capabilities digest, contract digest, golden bundle digest and capability matrix digest.
  - A binary or source digest mismatch is rejected by policy and never falls back to another build.
  - Sidecar startup is bounded by a timeout, a live sidecar can be killed with no surviving process, and a missing binary is unavailable while the host verdict stays unchanged.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-mc3-delivery.mjs --out harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json
  - node scripts/verify-versegit-mc3.mjs --artifact harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json
  - pnpm exec vitest run tests/unit/versegit-mc3-delivery.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-mc3-sidecar-delivery.md
acceptance:
  - The manifest carries every required identity field, is addressed by the binary digest, and records that no mutable checkout path is consumed.
  - The independent verifier recomputes the live binary digest, byte length, source commit and all bundle digests and rejects any drift from the frozen manifest.
  - Startup smoke covers version, capabilities, a doctor call without provider state, the timeout budget, the kill switch with zero survivors, and a missing binary that leaves the host verdict unchanged.
  - The install and temp roots are proven to be off the system drive, the cleanup leaves no fixture directory or sidecar process behind, and no host worktree is deleted.
  - The manifest records that the VerseGit source tree, .git, build outputs, Task Forest and private evidence did not enter ClawX, and stays rejected while the provider source is dirty or the release binary is not built.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md
---

# MC3 sidecar delivery

This node fixes how VerseGit is delivered to ClawX. It does not implement the
host adapter, harness profile, VerseShell receipt bridge or any VG source change,
and it never invokes `vg land` or `vg admit`.
