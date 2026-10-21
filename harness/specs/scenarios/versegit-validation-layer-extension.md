---
id: versegit-validation-layer-extension
title: VerseGit Concurrent Workspace Control Plane
type: auxiliary-concurrency-control-plane
ownedPaths:
  - harness/specs/rules/versegit-validation-layer-extension-boundary.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/tasks/versegit-module-planning-correction.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
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
  - harness/specs/tasks/versegit-wp6-merged-closeout.md
  - harness/specs/tasks/versegit-mc6-extraction-decision.md
  - harness/specs/tasks/versegit-wp7-host-vertical-slice.md
  - electron/services/versegit-module.ts
  - electron/services/versegit-observation.ts
  - electron/services/versegit-receipt-bridge.ts
  - electron/services/versegit-behavior-coverage.ts
  - harness/src/profiles.mjs
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
  - scripts/versegit-wp6-closeout.mjs
  - scripts/verify-versegit-wp6.mjs
  - scripts/verify-versegit-mc6.mjs
  - scripts/versegit-wp7-host-vertical.mts
  - scripts/verify-versegit-wp7.mts
  - scripts/validate-versegit-planning-correction.mjs
  - tests/unit/versegit-mc4-adapter.test.ts
  - tests/unit/versegit-wp1-observation.test.ts
  - tests/unit/versegit-wp2-profile.test.ts
  - tests/unit/versegit-wp3-receipts.test.ts
  - tests/unit/versegit-wp4-coverage.test.ts
  - tests/unit/versegit-wp5-soak.test.ts
  - tests/unit/versegit-wp6-closeout.test.ts
  - tests/unit/versegit-wp7-host-vertical.test.ts
  - artifacts/versegit/wp6/**
  - artifacts/versegit/mc6/**
  - artifacts/versegit/wp7/**
  - harness/specs/guides/versegit-concurrency/**
  - harness/specs/fixtures/versegit-planning-correction/**
  - docs/dev/versegit-validation-layer/README.md
  - harness/src/profiles.mjs
requiredRules:
  - versegit-validation-layer-extension-boundary
---

VerseGit (VG) participates in ClawX as an **opt-in, host-managed repository fact and
candidate control plane** for genuinely concurrent development. ClawX keeps
orchestration, approval, execution, mutation-journal, and final harness authority.

2026-10-22 closeout status: MC0-MC5 and WP0-WP5 are evidence-backed, and WP6 recomputes 12/12 required gates plus the optional MC6 sidecar-only decision. The module is non-GA, default-off, landed-unwired and release-ineligible while the provider source is dirty and only a debug sidecar exists. WP7 adds one bounded live VerseShell candidate-verification receipt for a disposable host-shaped vertical slice; this is not full product M3 acceptance. The conflicts-plan seam remains unavailable and M4 is not authorized.

## Authority

| Plane | Owner | VG role |
| --- | --- | --- |
| Task graph and Agent assignment | ClawX orchestrator / Task Ledger / ClawGraph | advisory facts only |
| Process and file execution | VerseShell governed ACI | consumer of execution receipts |
| User workspace mutation journal | ClawX write journal | read-only observation |
| Repository session / candidate facts | VG ledger and receipts | authoritative within its domain |
| Harness pass/fail | harness task spec and profile | auxiliary evidence only |
| Project development DAG | Task Forest | linked task/evidence reference |

VG must not become a second task graph, executor, approval channel, write journal,
or harness verdict owner.

## Modes

- `M0 disabled`: no process, attachment, or behaviour change.
- `M1 diagnostic`: only verified target provider seams; existing CLI names are not proof of read-only behaviour.
- `M2 advisory`: host observations plus next-tree/candidate risk facts.
- `M3 candidate`: fixed verification plans executed by VerseShell; VG consumes receipts and emits verdict facts.
- `M4 broker`: optional CAS-landing authority, outside this scenario and requiring a separate ownership decision.

No mode may silently promote itself to another mode.

## Trigger surface

Eligible only when the same canonical repository has more than one Git worktree,
more than one active Agent/VG session, or an orchestration plan explicitly
requesting worktree isolation. A single-worktree, single-session repository sees
zero VG behaviour. The module requires an explicit opt-in profile and is never
part of `fast`, `comms`, or an implicit task default.

## Execution coupling

In ClawX host mode, user-code commands, tests, builds and verification runs use
VerseShell's governed ACI. A caller-provided receipt is not evidence: the host reads
its own process/artifact authority. Without a host-authoritative receipt,
verification is `unmeasured`.

M1/M2 repository facts use the host-owned typed VerseGit adapter with a frozen
fixed-argv allowlist in a host-created workspace. It may update only VG
provider-domain state, records binary/argv/cwd/pid/exit/timeout/output digests,
and cannot run user code, tests, builds, arbitrary model argv or land/admit.
This is a provider fact seam, not a second verifier or execution authority.

VerseShell remains the sole executor for user code, tests, builds and candidate
verification, and the sole source of host-authoritative execution receipts. VG
must not spawn a second verifier, interpret shell strings, or fall back to native
execution for verification. `vg land` and `vg admit` are not invoked by M1-M3.

## Failure posture

VG is fail-open for harness verdicts and fail-closed for authority or identity.
Top-level status is one of `not_applicable`, `unavailable`, `partial`, `observed`,
`degraded`, or `rejected_by_policy`. Reasons such as `stale`, `unknown`,
`unmeasured`, `recovery_required`, `lost`, `identity_mismatch`,
`invalid_candidate`, and `report_incomplete` are not top-level statuses.

## Lifecycle and cleanup

VG attaches after ClawX creates a worktree/session and detaches before cleanup.
The single host cleanup barrier is stop -> drain/cancel -> seal evidence ->
detach VG -> verify owner/epoch/reference -> delete disposable worktree. It covers
programmatic cleanup, user-requested cleanup, stale pruning and failure-path
cleanup. VG never deletes a host worktree. Any barrier failure preserves the
resource and records `recovery_required`.

## Coverage and evidence

Symbol coverage is language-specific, not full language-service coverage. Read
coverage is partial; Bash, network, arbitrary MCP and direct filesystem reads may
be unobserved. Reports must include a coverage vector. Absence of a conflict is
only "no conflict observed under declared coverage". VG evidence is auxiliary and
never satisfies a full harness gate or upgrades a host verdict.

## Migration control

Adoption is migration-controlled, not a source-tree rewrite. The entire VG source
tree, Task Forest history, build outputs, evaluation corpora and private evidence
must not be copied into ClawX. Planning correction and implementation contracts are
in `harness/specs/tasks/versegit-module-planning-correction.md` and
`harness/specs/tasks/versegit-module-implementation-contracts.md`.

## Ecosystem linkage

VG may be exposed through its own deny-by-default read-only MCP surface or a
host-owned typed adapter. It must not be nested as a generic tool inside
`verseshell-mcp`. `declare_intent` and future write tools are excluded from the
default read-only profile.
