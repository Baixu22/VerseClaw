---
lifecycleStatus: active
id: versegit-mc4-module-adapter
title: MC4 - implement the host-owned VerseGit module adapter
scenario: versegit-validation-layer-extension
taskType: planning
intent: Implement the shipped Electron Main adapter over the frozen VerseGit sidecar and prove differential equivalence, default-off behaviour, authority refusal and fail-open availability before any host route, profile or VerseShell receipt bridge is added.
touchedAreas:
  - harness/specs/tasks/versegit-mc4-module-adapter.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/fixtures/versegit-planning-correction/mc4-adapter-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/mc4-evidence/**
  - artifacts/versegit/mc4/**
  - artifacts/versegit-planning-correction/SHA256SUMS
  - electron/services/versegit-module.ts
  - scripts/versegit-mc4-adapter.mjs
  - scripts/verify-versegit-mc4.mjs
  - tests/unit/versegit-mc4-adapter.test.ts
expectedUserBehavior:
  - The differential harness imports the shipped Electron Main adapter and exercises exported adapter methods rather than a parallel copy of their projection logic.
  - M0 remains inert with zero sidecar processes, no attachment, no workspace write and an unchanged host verdict.
  - Only the verified capabilities command is reachable; land, admit, declare_intent, Git publish commands and unverified historical CLI names are refused before a process is created.
  - Missing binaries, crashes and timeouts produce unavailable or degraded facts without failing the host harness.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-mc4-adapter.mjs --out harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json
  - node scripts/verify-versegit-mc4.mjs --artifact harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json
  - pnpm exec vitest run tests/unit/versegit-mc4-adapter.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-mc4-module-adapter.md
acceptance:
  - At least two identity seams execute the frozen sidecar through the imported adapter and are semantically equal to the raw sidecar reference under the MC5 projection, with no behavior-change record.
  - Provenance binds the adapter source, frozen source commit, binary digest, canonical MC1 contract digest, MC2 golden digest and MC3 package digest, and all four identities agree with WP0.
  - M0 performs zero adapter process calls, attaches nothing, writes no workspace, pins harness verdict and Git landing to the host and leaves the host verdict unchanged.
  - Ungranted or mismatched promotion, reason-as-status, authority fields, shell strings, effectful auto-replay and forbidden command heads are refused with an unchanged host verdict.
  - `capabilities` is the only verified command; `doctor`, `session`, `verdict`, `conflicts` and `report` are explicitly deferred, and `declare_intent` is forbidden.
  - The adapter adds no runtime dependency, imports no VerseGit internals and adds no renderer route, harness profile, fast/comms membership or VerseShell execution path.
  - The stored report is digest-reproducible and the independent verifier rebuilds the live differential and re-fires the refusal matrix.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
---

# MC4 host-owned module adapter

This node implements the narrow host-owned adapter foundation. It consumes the frozen
sidecar through public argv seams and emits host-shaped facts. It does not add a host
route, a renderer surface, a harness profile, a VerseShell receipt bridge or any
landing authority. Those remain WP1-WP3 and the optional M4 decision.

## Migration boundary

The evidence harness imports `electron/services/versegit-module.ts` directly. It does
not copy VerseGit source into ClawX, invoke a second verifier, use a shell string or
re-author the provider's result in a parallel adapter. The raw sidecar output remains
the reference side of each differential seam.

## Authority boundary

An explicit matching grant is required for M1-M3. M0 never attaches. The module report
reserves harness verdict, execution and landing ownership for ClawX, always reports
`host_verdict: unchanged`, and rejects reason labels used as top-level statuses. The
command surface is deny-by-default and intentionally narrower than the VG CLI: only the
capabilities seam is verified in MC4.

## Deferred integration

WP1 owns event identity and stale/duplicate handling. WP2 owns the opt-in harness
profile and evidence pack. WP3 owns VerseShell execution receipts and candidate facts.
WP4-WP6 own coverage, replay/soak and merged closeout.