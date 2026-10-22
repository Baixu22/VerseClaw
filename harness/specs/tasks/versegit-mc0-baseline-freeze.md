---
lifecycleStatus: active
id: versegit-mc0-baseline-freeze
title: MC0 - freeze VerseGit source, binary, schema and golden baseline
scenario: versegit-validation-layer-extension
taskType: planning
intent: Establish an evidence-backed baseline for the VerseGit module before contract, fingerprint, delivery or adapter work begins, while refusing dirty source as a deliverable baseline.
touchedAreas:
  - harness/specs/tasks/versegit-mc0-baseline-freeze.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/fixtures/versegit-planning-correction/mc0-baseline-fixture.json
  - scripts/versegit-mc0-baseline.mjs
  - scripts/verify-versegit-mc0.mjs
  - tests/unit/versegit-mc0-baseline.test.ts
  - artifacts/versegit/mc0/**
expectedUserBehavior:
  - The baseline names the exact VerseGit source commit, tree, worktree state, toolchain, binary digest, schema versions, capabilities digest and representative golden commands.
  - A dirty VerseGit worktree is recorded as rejected rather than promoted to a deliverable baseline.
  - A future session can distinguish diagnostic evidence from a release-eligible baseline without guessing.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-mc0-baseline.mjs --repo D:/Projects/VerseGit --out artifacts/versegit/mc0/baseline.json
  - node scripts/verify-versegit-mc0.mjs --repo D:/Projects/VerseGit --artifact artifacts/versegit/mc0/baseline.json
  - pnpm exec vitest run tests/unit/versegit-mc0-baseline.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-mc0-baseline-freeze.md
acceptance:
  - The artifact records source head, tree, dirty/clean state, toolchain, version, VG schema, ledger schema, binary digest, capabilities digest and at least two golden cases.
  - Dirty source produces deliverable=rejected with explicit blockers and no fabricated eligibility.
  - The verifier recomputes the live source and binary identity and rejects drift from the frozen artifact.
  - The artifact explicitly records that no VG source tree, history, Task Forest, build outputs or private evidence were copied into ClawX.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md
---

# MC0 baseline freeze

This node freezes what is being migrated. It does not make the current VerseGit
checkout deliverable and does not implement MC1/MC2/MC3 or any adapter.