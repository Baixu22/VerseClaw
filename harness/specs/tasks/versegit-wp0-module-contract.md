---
lifecycleStatus: active
id: versegit-wp0-module-contract
title: WP0 - fix the VerseGit module contract, binary identity and version matrix
scenario: versegit-validation-layer-extension
taskType: planning
intent: Publish the machine-readable module identity, version matrix, read-only MCP catalog and mode matrix the ClawX harness must check before it may attach the VerseGit sidecar in any mode.
touchedAreas:
  - harness/specs/tasks/versegit-wp0-module-contract.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/fixtures/versegit-planning-correction/wp0-contract-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp0-evidence/**
  - scripts/versegit-wp0-contract.mjs
  - scripts/verify-versegit-wp0.mjs
  - tests/unit/versegit-wp0-contract.test.ts
expectedUserBehavior:
  - A future session can read one contract that names the frozen binary digest, source commit, VG schema, ledger schema, capabilities digest and every cross-boundary schema version the host may accept.
  - The read-only MCP catalog is deny-by-default, digested, and provably excludes declare_intent and every other write tool.
  - M0 starts no process and attaches nothing; no mode may write the user workspace or change the harness verdict; M3 execution is VerseShell-only.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-wp0-contract.mjs --out harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json
  - node scripts/verify-versegit-wp0.mjs --artifact harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json
  - pnpm exec vitest run tests/unit/versegit-wp0-contract.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp0-module-contract.md
acceptance:
  - The contract binds the MC0 binary identity, the MC1 consumer contract digest, the MC2 golden bundle digest and the MC3 sidecar package digest into one version matrix.
  - The gate passes only for a matching identity and refuses binary digest drift, capabilities schema or digest drift, a too-new ledger schema and an unsupported contract version, each reported without changing the harness verdict.
  - A missing binary is reported unavailable and short-circuits, because nothing else could have been probed.
  - The identity probe creates or attaches no session, writes no provider state, and leaves the provider workspace byte-identical before and after.
  - The contract records default-off, the three concurrency triggers, zero single-worktree commands, and that the module is not part of fast, comms or any implicit profile.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
---

# WP0 module contract and identity

This node fixes what the harness is allowed to trust before attaching VerseGit.
It does not implement the adapter, observation bridge, harness profile or
VerseShell receipt bridge, and it never invokes `vg land` or `vg admit`.
