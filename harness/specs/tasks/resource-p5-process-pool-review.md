---
lifecycleStatus: active
id: resource-p5-process-pool-review
title: Long-lived git/office process pool decision for TF-0415
type: task
intent: Record an explicit implement-or-reject decision for a general long-lived utilityProcess pool around read-only git and OfficeCLI commands, using local call-site evidence, a controlled relay benchmark, Windows lifecycle risks and a rollback path.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - harness/specs/tasks/resource-p5-process-pool-review.md
  - harness/specs/fixtures/tf0415-p5-process-pool/**
---

# TF-0415 P5 Process-Pool Review

## Objective

Decide whether the Resource Fabric should add `min(2, cpus/4)` long-lived
utilityProcess workers for git and OfficeCLI reads, with 60-second idle
reclamation. Stop at P4 when the lifecycle risk and measured benefit do not
justify implementation.

## Acceptance

- The decision is explicitly `implement` or `reject`; no ambiguous middle state.
- Local evidence covers existing git status caching/singleflight, officecli
  watch reuse, per-command spawn behavior and Windows process-tree risk.
- A reproducible controlled sample compares direct git execution with a
  persistent relay that still spawns git per job.
- Benefits, risks and rollback path are recorded.
- A rejection records the unimplemented process-pool gap and does not claim a
  performance win.
- No production behavior, product lock or frozen default changes in this node.
## Decision

**Reject a general long-lived utilityProcess pool for git/office reads in the
current Windows x64 Controlled Preview. P5 stops at P4. No production behavior
is changed, and the unimplemented process-pool path remains an explicit gap.**

## Local evidence

- `electron/services/git-api.ts` already applies a 5-second `BoundedCache` and
  `Singleflight` to repeated git status reads, then invalidates by repo root
  after mutations.
- The centralized git `execBinary` boundary owns per-command cwd, env,
  `GIT_OPTIONAL_LOCKS=0`, disabled hooks/fsmonitor, terminal-prompt suppression,
  a 15-second timeout and `SIGKILL`. A long-lived worker must reconstruct and
  validate all of that per job rather than inherit mutable process state.
- `electron/services/office-tools-api.ts` already reuses `officecli watch`
  processes by file key with refcounts and a 32-instance cap. `view` and
  `load_skill` remain one-shot commands with no current batch protocol; adding a
  worker around them still spawns officecli per job.
- Windows git grandchildren can outlive the direct `execFile` timeout, as the
  existing wrapper comment records. A safe pool therefore needs process-tree
  termination, not only worker `kill()`.
- `electron/utils/counted-child-process.ts` already records spawn counts, so a
  real hotspot can be detected before adding a new lifecycle layer.

## Controlled measurement

`harness/specs/fixtures/tf0415-p5-process-pool/worker-overhead.json` records 30
ABBA-style paired samples of `git rev-parse HEAD` on Windows:

- direct `execFile`: P50 35.3548 ms
- persistent relay that still `execFile`s git per job: P50 36.4728 ms
- P50 reduction: approximately -3.16%, versus the >=50% implementation gate

The relay is not Electron `utilityProcess`, but it models the relevant control
flow: a persistent Node process receiving jobs while still creating the external
git child process for every job. The result is a local controlled sample, not a
cross-platform benchmark; rejection also rests on the local call structure and
Windows lifecycle risk.

## Benefits and risks

Potential benefit: if the app ever shows a high-concurrency spawn storm, moving
spawn calls out of Main could reduce Main-thread blocking. Current evidence does
not show that bottleneck, and a persistent relay does not remove the external
CLI process cost.

Risks that block implementation now:

- Windows process-tree or grandchild leakage and App-update residue;
- stale env, proxy, credential, cwd or approval context crossing workspaces;
- two competing long-lived lifecycles beside the existing officecli watch reuse;
- worker crash/restart and queue failure modes without a demonstrated need;
- additional resident RSS with no measured 60-second reclamation curve.

## Rollback

No production code changed, so rollback means retaining the P4 direct execution
path. Any future implementation must keep `execFile` as the default and fallback,
gate the pool behind a feature flag, carry full job context explicitly, cap
workers at `min(2, max(1, floor(cpus/4)))`, reclaim after 60 seconds, kill the
Windows process tree, and retain spawn/RSS/latency evidence in the same change.

## Reopen conditions

Reopen only when all of the following hold:

1. Real workload evidence shows repeated read-only git/office calls are a
   perceptible bottleneck.
2. The proposed design removes per-command CLI spawn or uses a supported batch
   protocol; a relay alone is insufficient.
3. The target workload improves P50 by at least 50% against the direct path.
4. Windows process-tree cleanup, orphan scanning, crash recovery and RSS after
   reclamation are verified by readable artifacts.

## External references

- Electron utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
- Node.js child_process: https://nodejs.org/api/child_process.html
- Val Town process-spawn benchmark: https://blog.val.town/node-spawn-performance
