---
lifecycleStatus: active
id: versegit-mc2-behavior-fingerprint
title: MC2 - record the VerseGit behavior fingerprint
scenario: versegit-validation-layer-extension
taskType: planning
intent: Turn the frozen VerseGit binary's observable behavior into machine-checkable golden facts before sidecar delivery or adapter work, while keeping every probe inside a disposable fixture.
touchedAreas:
  - harness/specs/tasks/versegit-mc2-behavior-fingerprint.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/fixtures/versegit-planning-correction/mc2-golden-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/mc2-evidence/**
  - scripts/versegit-mc2-fingerprint.mjs
  - scripts/verify-versegit-mc2.mjs
  - tests/unit/versegit-mc2-fingerprint.test.ts
expectedUserBehavior:
  - The fingerprint names the frozen binary and source identity it was recorded from and recomputes to the same case digests on re-run.
  - Producer/consumer, multi-worktree, verification and error behavior are recorded as golden shapes rather than prose.
  - Negative controls prove silence is evidence-based, and unobserved surfaces stay declared instead of implied clean.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-mc2-fingerprint.mjs --out harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json
  - node scripts/verify-versegit-mc2.mjs --artifact harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json
  - pnpm exec vitest run tests/unit/versegit-mc2-fingerprint.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-mc2-behavior-fingerprint.md
acceptance:
  - The artifact binds the fingerprint to the MC0 frozen binary and source head and refuses a binary digest mismatch.
  - At least one producer/consumer positive control, five negative controls and five error paths are recorded with exit codes, stderr classes, normalized JSON and output digests.
  - Volatile identifiers and absolute paths are normalized to placeholders, and the validator rejects any raw uuid, object id, sha256 or absolute path leak.
  - The disposable fixture is fully removed after the run, no host or user worktree is deleted, and the artifact records that no VG source, history, Task Forest, build output or private evidence was copied.
  - The artifact records unobserved surfaces and keeps deliverable=rejected while the VerseGit source baseline is dirty.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md
---

# MC2 behavior fingerprint

This node freezes how the original VerseGit binary behaves. It does not implement
the adapter, sidecar delivery, harness profile or VerseShell bridge, and it never
invokes `vg land` or `vg admit`.
