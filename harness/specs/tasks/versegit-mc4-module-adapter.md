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
  - Every frozen binary/source/contract/golden/package identity is revalidated before the mutable sidecar executable is allowed to run.
  - The differential harness imports the shipped Electron Main adapter and compares the complete projected capability document, not a hand-picked summary.
  - M0 remains inert with zero sidecar processes, no attachment, no workspace write, zero recorded usage and an unchanged host verdict.
  - Only the verified capabilities command is reachable; forbidden fields, empty owners, shell strings, shell interpreters, path-qualified Git commands and undeclared retry values are refused.
  - Missing binaries, crashes, timeouts and valid JSON null produce structured unavailable/degraded facts without failing the host harness.
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
  - At least two identity seams execute the frozen sidecar through the imported adapter and compare the complete projected provider document to the raw sidecar reference, with no behavior-change record and no lost projected fields.
  - A pre-execution identity gate recomputes the actual binary digest, provider HEAD/tree and porcelain digest, validates internal MC0/MC2/MC3 digests plus MC1/MC2/MC3/WP0 cross-links, and proves source/binary/contract/golden/package agreement before any adapter process starts.
  - Six semantic-loss controls fire for version drift, dropped capability fields, single-green-light laundering, lost unobserved coverage, authority claims and a `drop_keys` projection that would hide a field.
  - M0 performs zero adapter process calls, attaches nothing, writes no workspace, records zero usage, pins harness verdict and Git landing to the host and leaves the host verdict unchanged.
  - Reports are bound to the effective grant, real usage counters, non-empty repo/worktree/session identity and run/request/trace correlation; a promoted report cannot be generated before attach, session identities must match the report identity vector, native verification executors are refused and caller digests cannot override the host contract digest.
  - Deep MC1 conformance checks report/plan required and forbidden fields, mode permissions and failure mappings; `missing_receipt` maps to `unmeasured` and `partial_coverage` to `report_incomplete`.
  - Ungranted or mismatched promotion, reason-as-status, authority fields, shell strings, top-level land/admit, empty owners, path-qualified Git commands, shell interpreters, unknown retries and effectful replay are refused with an unchanged host verdict.
  - `capabilities` is the only verified command; `doctor`, `session`, `verdict`, `conflicts` and `report` are explicitly deferred, and `declare_intent` is forbidden.
  - JSON null, schema drift, default-enable, single-green-light and capability digest drift are refused without an uncaught exception.
  - The adapter adds no runtime dependency, imports no VerseGit internals and adds no renderer route, harness profile, fast/comms membership or VerseShell execution path.
  - The report classifies MC4 as a host-owned adapter bootstrap, claims no provider source/internal import, and leaves the MC5 bootstrap-budget exception pending explicit owner authorization rather than self-authorizing it; the task must remain open until that decision is recorded.
  - The stored report is digest-reproducible and the independent verifier rebuilds the live differential and re-fires the identity, capability, report and command-plan refusal matrices.
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
`host_verdict: unchanged`, and rejects reason labels used as top-level statuses. Reports
are generated only for the effective mode, carry actual process/read usage separately
from the permission matrix, and preserve repo/worktree/session/epoch plus
run/request/trace correlation. The command surface is deny-by-default and intentionally
narrower than the VG CLI: only the capabilities seam is verified in MC4.

## Migration budget scope

MC4 adds host-owned anti-corruption code; it does not copy or replace provider source.
The report therefore records `behavior_migration: false`, zero provider source files and
zero provider internal imports. No host-owned exemption exists in the upstream MC5 rule,
so the report must keep `authorization_status: pending_owner_decision` and
`mc5_bootstrap_budget_owner_decision` as an explicit closure blocker until the repository
owner chooses either a bounded bootstrap exception or a node split. The adapter must not
self-authorize the exception.

## Deferred integration

WP1 supplies the event identity and stale/duplicate bridge. WP2 owns the opt-in harness
profile and evidence pack. WP3 owns VerseShell execution receipts and candidate facts.
WP4-WP6 own coverage, replay/soak and merged closeout.