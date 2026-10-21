---
lifecycleStatus: planned
id: versegit-module-implementation-contracts
title: VerseGit module implementation node contracts
scenario: versegit-validation-layer-extension
taskType: planning
intent: Provide the per-node execution, fixture, artifact, verifier and closure contract required before any VerseGit adapter or harness-profile implementation starts.
touchedAreas:
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/tasks/versegit-module-planning-correction.md
  - harness/specs/tasks/versegit-mc0-baseline-freeze.md
  - harness/specs/tasks/versegit-mc1-consumer-contract.md
  - harness/specs/tasks/versegit-mc2-behavior-fingerprint.md
  - harness/specs/tasks/versegit-mc3-sidecar-delivery.md
  - harness/specs/tasks/versegit-wp0-module-contract.md
  - harness/specs/tasks/versegit-mc5-differential-gate.md
  - harness/specs/tasks/versegit-mc4-module-adapter.md
  - harness/specs/tasks/versegit-wp1-observation-bridge.md
  - harness/specs/tasks/versegit-wp2-diagnostic-profile.md
  - harness/specs/tasks/versegit-wp3-receipt-bridge.md
  - harness/specs/tasks/versegit-wp4-behavior-coverage.md
  - harness/specs/tasks/versegit-wp5-replay-soak.md
  - electron/services/versegit-module.ts
  - electron/services/versegit-observation.ts
  - electron/services/versegit-receipt-bridge.ts
  - electron/services/versegit-behavior-coverage.ts
  - harness/src/profiles.mjs
  - scripts/versegit-mc1-contract.mjs
  - scripts/verify-versegit-mc1.mjs
  - scripts/versegit-mc2-fingerprint.mjs
  - scripts/verify-versegit-mc2.mjs
  - scripts/versegit-mc3-delivery.mjs
  - scripts/verify-versegit-mc3.mjs
  - scripts/versegit-wp0-contract.mjs
  - scripts/verify-versegit-wp0.mjs
  - scripts/versegit-mc5-differential.mjs
  - scripts/verify-versegit-mc5.mjs
  - scripts/versegit-mc4-adapter.mjs
  - scripts/verify-versegit-mc4.mjs
  - scripts/versegit-wp1-observation.mjs
  - scripts/verify-versegit-wp1.mjs
  - scripts/versegit-wp2-profile.mjs
  - scripts/verify-versegit-wp2.mjs
  - scripts/versegit-wp3-receipts.mjs
  - scripts/verify-versegit-wp3.mjs
  - scripts/versegit-wp4-coverage.mjs
  - scripts/verify-versegit-wp4.mjs
  - scripts/versegit-wp5-soak.mjs
  - scripts/verify-versegit-wp5.mjs
  - tests/unit/versegit-mc1-contract.test.ts
  - tests/unit/versegit-mc2-fingerprint.test.ts
  - tests/unit/versegit-mc3-delivery.test.ts
  - tests/unit/versegit-wp0-contract.test.ts
  - tests/unit/versegit-mc5-differential.test.ts
  - tests/unit/versegit-mc4-adapter.test.ts
  - tests/unit/versegit-wp1-observation.test.ts
  - tests/unit/versegit-wp2-profile.test.ts
  - tests/unit/versegit-wp3-receipts.test.ts
  - tests/unit/versegit-wp4-coverage.test.ts
  - tests/unit/versegit-wp5-soak.test.ts
  - harness/specs/guides/versegit-concurrency/**
  - harness/specs/fixtures/versegit-planning-correction/**
  - scripts/validate-versegit-planning-correction.mjs
  - tests/unit/versegit-planning-correction.test.ts
expectedUserBehavior:
  - A future session can resolve every WP/MC node to its task anchor, fixture, artifact, verifier and closure condition.
  - The implementation order cannot bypass MC0-MC3 or MC5.
  - Optional extraction and merged closeout nodes are explicit rather than implied.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/validate-versegit-planning-correction.mjs
  - pnpm exec vitest run tests/unit/versegit-planning-correction.test.ts
acceptance:
  - The planning contract bundle validates without errors.
  - Every active WP/MC node has a unique anchor, fixture, artifact, verifier and closure condition.
  - The DAG forbids implementation before baseline, contract, fingerprint, delivery and differential gates.
  - Optional MC6 and merged MC7 dispositions are explicit.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md
---

# VerseGit module implementation node contracts

This spec is a contract index, not an implementation task. TF-0481 is closed; each execution node is authorized only by its own fixture, artifact, verifier and acceptance evidence.

## TF-0465 — global goal

Close only when every required child gate closes or is explicitly retired.

## TF-0473 — MC0 baseline

Freeze effective source, build recipe, lock inputs, binary digest, schema version, capabilities digest and representative golden inputs.

## TF-0474 — MC1 contract

Define and test the anti-corruption sidecar contract and status/error semantics.

## TF-0475 — MC2 fingerprint

Record characterization/golden behavior for identity, health, diagnostic facts, error paths and cleanup.

## TF-0476 — MC3 delivery

Produce a digest-addressed sidecar package with reproducible build and startup/recovery evidence.

## TF-0466 — WP0 identity/profile contract

Define module-report and command-plan schemas, mode matrix and version compatibility.

## TF-0478 — MC5 differential framework

Build the comparison harness, diff budget, semantic projection and behavior-change report before adapter implementation.

## TF-0477 — MC4 adapter foundation

Implement one seam at a time through the public contract and prove differential equivalence.

## TF-0467 — WP1 observation bridge

Bind host tool events to repo/worktree/session/trace identity and reject stale or duplicate events.

## TF-0468 — WP2 diagnostic profile

Add the opt-in read-only harness profile and evidence pack with fail-open behavior.

## TF-0469 — WP3 receipt bridge

Route verification plans through VerseShell and consume only host-authoritative execution receipts.

## TF-0470 — WP4 behavior coverage

Emit coverage vectors, feedback-delivery tiers and bounded behavior events.

## TF-0471 — WP5 replay and soak

Run bounded multi-worktree, producer-consumer, three-way composition and failure-injection cases.

## TF-0472 — WP6 merged closeout

Close module evidence, migration retirement and the M4 broker decision boundary in one authority.

## TF-0479 — MC6 optional extraction

Optional only. It may run only if measured sidecar limitations prove an in-process requirement.

## TF-0480 — MC7 merged

Deprecated. Its closeout responsibilities are merged into TF-0472 to avoid duplicate authority.