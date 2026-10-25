---
lifecycleStatus: active
id: versegit-wp5-replay-soak
title: WP5 - bounded concurrency replay, soak and failure matrix
scenario: versegit-validation-layer-extension
taskType: planning
intent: Exercise the observation and receipt bridges with disposable multi-worktree repositories, repeated runs and injected availability/crash/report-tamper failures, while proving cleanup and preserving pass and failure facts.
touchedAreas:
  - harness/specs/tasks/versegit-wp5-replay-soak.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/fixtures/versegit-planning-correction/wp5-soak-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp5-evidence/**
  - artifacts/versegit/wp5/**
  - artifacts/versegit-planning-correction/SHA256SUMS
  - scripts/versegit-wp5-soak.mjs
  - scripts/verify-versegit-wp5.mjs
  - tests/unit/versegit-wp5-soak.test.ts
expectedUserBehavior:
  - A bounded three-cycle disposable repository creates two real worktrees, binds distinct producer/consumer sessions and retains explicit stale, unknown, unavailable and failure facts.
  - Every cycle removes both worktrees and its temp root; no VG process, host worktree deletion or verification execution is claimed.
  - VerseShell-unavailable, sidecar-crash and report-tamper controls remain separate from the host verdict.
  - The report lists actual cycle outcomes, cleanup counts, unavailable/unknown boundaries and unrun language/platform/read surfaces.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp5-soak.mjs --fixture harness/specs/fixtures/versegit-planning-correction/wp5-soak-fixture.json --out artifacts/versegit/wp5/soak-report.json
  - node scripts/verify-versegit-wp5.mjs --artifact artifacts/versegit/wp5/soak-report.json
  - pnpm exec vitest run tests/unit/versegit-wp5-soak.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp5-replay-soak.md
acceptance:
  - Three repeated cycles pass with two disposable worktrees each and zero survivors/temp roots after cleanup.
  - Producer/consumer identities do not cross; stale epoch is rejected; unsupported/language/read surfaces remain explicit and unobserved.
  - VerseShell unavailable is unmeasured rather than passed; sidecar crash is unavailable; report tamper is rejected.
  - Host verdict stays unchanged, no VG process is started, no host worktree is deleted and raw failure facts are preserved.
  - Verifier independently replays the fixture, compares normalized outcomes and checks cleanup boundaries.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md
---

# WP5 bounded replay and soak

This is a bounded host-side replay. The disposable worktrees are created and removed
by the evidence harness under `D:\tmp`; they are not VG candidate worktrees and VG
never deletes them.

## Failure matrix

The report must show positive cycles separately from:
`single_worktree`, `verseshell_unavailable`, `sidecar_crash` and `report_tamper`.
Failure data is retained even when another control passes.