---
id: versegit-validation-layer-extension
title: VerseGit Concurrent Workspace Control Plane
type: auxiliary-concurrency-control-plane
ownedPaths:
  - harness/specs/rules/versegit-validation-layer-extension-boundary.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - docs/dev/versegit-validation-layer/README.md
  - harness/specs/guides/versegit-concurrency/**`n  - harness/specs/tasks/versegit-module-planning-correction.md`n  - harness/specs/tasks/versegit-module-implementation-contracts.md`n  - harness/specs/fixtures/versegit-planning-correction/**
  - harness/src/profiles.mjs
requiredRules:
  - versegit-validation-layer-extension-boundary
---

VerseGit (VG) participates in ClawX as an **opt-in, host-managed repository fact and
candidate control plane** for genuinely concurrent development. It is more than a
symbol-conflict plugin but remains an auxiliary layer: ClawX keeps orchestration,
approval, execution, mutation-journal, and final harness authority.

The stable entry point is `docs/dev/versegit-validation-layer/README.md`; durable design details live under `harness/specs/guides/versegit-concurrency/`.

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
- `M1 diagnostic`: read-only identity, health, conflict, and session facts.
- `M2 advisory`: host observations plus next-tree/candidate risk facts.
- `M3 candidate`: fixed verification plans executed by VerseShell; VG consumes
  receipts and emits verdict facts.
- `M4 broker`: optional CAS-landing authority. It is outside this scenario and
  requires a separate ownership decision and rule amendment.

No mode may silently promote itself to another mode.

## Trigger surface

Participation is eligible only when the repository is genuinely concurrent:

- more than one Git worktree for the same canonical repository; or
- more than one active Agent/VG session for that repository; or
- an orchestration plan explicitly requests worktree isolation.

A single-worktree, single-session repository must observe zero VG behaviour. The
module requires an explicit opt-in profile and is never part of `fast`, `comms`,
or a task spec's implicit default set.

## What it adds

Repository-scoped facts that path-level gates cannot express:

- session -> worktree -> base/tree identity binding;
- symbol-level read/write facts and freshness;
- candidate/next-tree composition risk;
- version-bound basis and verification receipts;
- a six-dimension verdict that never collapses to one green light.

Absence of a VG conflict under partial coverage is not a pass statement and never
upgrades a harness verdict.

## Execution coupling

In ClawX host mode, all external commands and verification runs use VerseShell's
governed ACI. VG must not spawn a second verifier, interpret shell strings, or
fall back to native execution. Without a VerseShell receipt, verification is
`unmeasured`.

`vg land` and `vg admit` are not invoked by M1-M3. The existing ClawX Git and
write-journal path remains the mutation and landing authority.

## Failure posture

VG is fail-open for harness verdicts and fail-closed for authority or identity:

- missing binary, unsupported version, uninitialised workspace, unsupported
  language, missing receipt, timeout, or partial observation is recorded and
  leaves the host verdict unchanged;
- evidence status distinguishes `not_applicable`, `unavailable`, `partial`,
  `observed`, `degraded`, and `rejected_by_policy`;
- an undefined owner, workspace, repo, candidate, or epoch is rejected rather than
  guessed;
- sidecar failure must not silently switch authority or execution backend.

## Evidence posture

VG outputs are auxiliary evidence with their own identity: binary digest, schema
version, repo/worktree/session set, trigger reason, observation coverage, run and
artifact digests. A red result must remain visible; a green result cannot replace
`requiredTests`, selected scope cannot satisfy full scope, and missing reads cannot
be written as an empty read set.

## Migration control

VG adoption is migration-controlled, not a source-tree rewrite. The durable plan is
`harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md`:
freeze source and behaviour first, use a versioned sidecar adapter, and require
characterization/golden tests plus differential diff gates before any adapter or
optional source-extraction work. The entire VG source tree, Task Forest history, build
outputs, and private evidence must not be copied into ClawX.

## Lifecycle linkage

VG attaches after ClawX creates a worktree/session and detaches before cleanup.
It must not create or delete user worktrees in host mode. Cleanup, retention, and
recovery follow the host lifecycle and preserve evidence references before
removing effective but disposable resources.

## Ecosystem linkage

VG may be exposed as a deny-by-default read-only capability through a host-owned
adapter or its own MCP server. It must not be nested inside the VerseShell MCP
adapter as a generic proxy. The write-only `declare_intent` MCP tool is excluded
from the default read-only profile.