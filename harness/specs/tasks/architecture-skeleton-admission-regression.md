---
lifecycleStatus: active
id: architecture-skeleton-admission-regression
title: Admission A6 — compatibility regression and admission convergence closeout
type: task
intent: Prove on a clean candidate that the A3–A5 admission migration removed the flat request surface without changing defaults, permission boundaries, or existing product behavior, then publish a reproducible regression matrix and converge the architecture gates.
requiredProfiles:
  - fast
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - repository-artifact-retention
  - docs-sync
  - agent-engineering-acceptance-boundary
  - task-forest-autoclose-and-roles
ownedPaths:
  - .gitignore
  - harness/specs/tasks/architecture-skeleton-admission-regression.md
  - docs/dev/architecture-skeleton/ADMISSION-CONVERGENCE.md
  - docs/dev/architecture-skeleton/CHARTER.md
  - scripts/repository-artifacts.json
  - artifacts/admission-convergence-20261102/**
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
  - docs/dev/error-governance-decision-record.md
  - harness/specs/rules/error-governance-boundary.md
  - scripts/check-error-governance.mjs
  - tests/unit/error-governance-boundary.test.ts
  - tests/unit/fixtures/error-governance/**
  - tests/e2e/agent-first-operational.spec.ts
  - tests/e2e/chat-welcome-hero-fakecoding.spec.ts
  - tests/e2e/chat-welcome-hero-verse-shot.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/long-session-restart-journeys.spec.ts
  - tests/e2e/startup-loading-experience.spec.ts
  - tests/e2e/versegit-feedback-paired.spec.ts
  - tests/unit/agent-first-mainline.test.ts
  - tests/unit/rsi-feedback-pilot.test.ts
  - tests/unit/rsi-sekb-arms.test.ts
  - tests/unit/versegit-wp6-closeout.test.ts
  - tests/unit/versegit-wp9-global-acceptance.test.ts
requiredTests:
  - pnpm run build:vite
  - pnpm run test:e2e:run
  - pnpm test
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm contract:check
  - pnpm repo:artifacts:check
  - pnpm harness run --spec harness/specs/tasks/architecture-skeleton-admission-regression.md --dry-run
acceptance:
  - Record exit codes for the full Electron E2E suite, full unit suite, typecheck, lint:check, contract:check, repo:artifacts:check, and harness dry-run on a clean candidate; classify every non-pass as code regression, environment failure, or not-run with the concrete reason.
  - Default configuration matrix and permission boundaries have zero diff against the pre-A3 baseline 97cda35de for docs/dev/default-config-matrix.md, shared/dcs defaults, electron/main/ipc/host-invoke.ts senderAuth, and electron/services/permissions-api.ts.
  - Publish docs/dev/architecture-skeleton/ADMISSION-CONVERGENCE.md plus a retained evidence directory with candidate commit/tree, command logs, exit codes, a hash manifest covering every retained evidence file, and a zero-hit credential scan.
  - Update CHARTER section 8 with measured values: unclassified admission channels = 0 and existing product behavior changes = 0 or an explicit itemized list.
  - Update TF-0628 summary in the same result; do not change TF-0628 status.
  - No runtime code changes are made by A6. Any regression leaves this node open and records a deviation for a follow-up A5 repair.
nonGoals:
  - Do not change runtime source, Host API actions, sender authentication, defaults, permission paths, product locks, release state, or UI behavior.
  - Do not relax or bypass any existing gate to turn a failure into a pass.
  - Do not claim real-human evidence; all runs are agent-driven.
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/ADMISSION-CONVERGENCE.md
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: not-required
---

# Admission A6 — compatibility regression and closeout

## Why

A3 migrated live flat-IPC consumers, A4 moved E2E mock seams to `host:invoke`, and A5
retired all 43 adjudicated flat channels plus the preload invoke door. The remaining
question is not whether the new seam exists, but whether the complete product still
behaves as before and whether the architecture claims now have measured evidence.

A6 is a read-and-prove node. It does not change runtime behavior.

## Candidate and baseline

A5 left one documentation/check residue: it deleted
`electron/main/ipc/request-helpers.ts` but the error-governance surface still
declared the removed duplicate `AppErrorCode` union and named that file as
evidence. A6 closes that stale declaration and the test-only lint/type residuals
in the same change set. These repairs do not add or change runtime behavior; the
A6 non-goal remains “no runtime source changes”.

- Pre-A3 baseline: `97cda35de` (the direct parent of A3 commit `512dc31a4`).
- Candidate: the A6 spec commit created from current `main`, recorded as commit and tree in
  `artifacts/admission-convergence-20261102/candidate.json`.
- Worktree: detached clean candidate under `D:	mp`; temporary paths stay on `D:` and are
  removed after the evidence is frozen.
- Test root: `TEMP`, `TMP`, and `CLAWX_E2E_RUN_ROOT` point under `D:	mp`.

## Regression matrix

| Axis | Command | Required evidence |
|---|---|---|
| Build | `pnpm run build:vite` | stdout/stderr logs and exit code |
| Electron E2E | `pnpm run test:e2e:run` | full per-spec result, duration, exit code |
| Unit | `pnpm test` | complete runner summary and exit code |
| Types | `pnpm run typecheck` | node/web/test project results and exit code |
| Lint | `pnpm run lint:check` | full command exit code; changed-file lint 0 warnings |
| Admission contract | `pnpm contract:check` | pass and fixture coverage |
| Artifact policy | `pnpm repo:artifacts:check` | retained evidence paths accepted |
| Harness | `pnpm harness run --spec ... --dry-run` | selected command plan and exit code |

Failures are classified only with direct evidence:

- `code-regression`: a deterministic failure caused by the candidate and reproducible by command.
- `environment`: launch/toolchain failure with the failing OS error and a baseline reproduction or documented host limitation.
- `not-run`: the command could not execute; never counted as a pass.

## Static boundary comparisons

The candidate must show zero diff against `97cda35de` for:

```text
docs/dev/default-config-matrix.md
shared/dcs/
electron/main/ipc/host-invoke.ts
electron/services/permissions-api.ts
```

The comparison is recorded as `boundary-diff.json`; any non-zero diff is itemized and
cannot be hidden inside an aggregate claim.

## Evidence directory

`artifacts/admission-convergence-20261102/` is a retained evidence directory. It must contain:

- `candidate.json` — commit, tree, branch/detached state, baseline ref and timestamps.
- `gates.json` — command, started/finished timestamps, duration, exit code, classification.
- `boundary-diff.json` — protected-path comparison result.
- `credential-scan.json` — patterns scanned and zero-hit result.
- `SHA256SUMS` — digest for every retained file except the manifest itself.
- command stdout/stderr logs and test summaries needed to reproduce each verdict.
- `report.md` — first-reader summary linking each claim to the files above.

Every evidence path is added to `scripts/repository-artifacts.json#retainedFiles`.
No secrets, provider keys, user data, or raw prompts are retained.

## Closeout

Update `docs/dev/architecture-skeleton/ADMISSION-CONVERGENCE.md` and CHARTER §8 only
after all evidence is frozen. Then update TF-0628 summary without changing its status and
close TF-0652 only when every acceptance criterion is backed by files on disk.

All execution is agent-driven (`driven_by: agent`); no human evidence is claimed.
