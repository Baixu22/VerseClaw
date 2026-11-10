---
id: product-acceptance-matrix
title: Core product journey matrix and candidate-bound execution
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Give TF-0582 a reproducible nine-group inventory and compare its frozen Playwright collection with actual results, preserving missing, failed, skipped and stale evidence.
diffBase: 5e9e865dc911e32615338c593694fa74d7bf8400
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - harness/specs/tasks/product-acceptance-matrix.md
  - harness/specs/fixtures/product-acceptance-matrix/**
  - scripts/product-acceptance-matrix.mjs
  - scripts/product-acceptance-matrix.d.mts
  - tests/unit/product-acceptance-matrix.test.ts
expectedUserBehavior:
  - The operator can inspect all nine product journeys, their positive and negative oracles, evidence layers and outstanding checks before running them.
  - A selected batch records every collected test and compares the actual report against that collection; an empty, incomplete, skipped or retried run cannot pass.
  - Reports identify the source candidate and distinguish selected-suite execution from the complete TF-0582 acceptance decision.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/product-acceptance-matrix.test.ts --maxWorkers=1
  - node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-acceptance-matrix.mjs --check
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/product-acceptance-matrix.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/product-acceptance-matrix.md --dry-run
  - git diff --check
acceptance:
  - The inventory contains all nine TF-0582 groups, covers every current default disposition entry and names real test files plus positive and negative final-state oracles.
  - The checker rejects a missing group, unmapped default entry, absent test file or empty oracle.
  - Frozen test source hashes reject removed cases or weakened assertions even if a new discovery and execution would agree.
  - Playwright discovery and execution use the same exact file list, one worker and zero retries; report errors, missing or extra tests, expected failures and skips fail the batch.
  - Runs retain commands, exits, raw JSON, hashes and before/after Git identities in a new output directory; dirty candidates cannot run acceptance.
  - Selected batches retain all unselected groups and the additional live, exploratory and rubric requirements as incomplete.
  - The parent TF-0582 contract remains the node closure authority; implementation checks alone do not close the node.
docs:
  required: true
  files:
    - harness/specs/tasks/product-acceptance-matrix.md
---

# Core product matrix

`harness/specs/fixtures/product-acceptance-matrix/inventory.json` binds the nine
TF-0582 journeys to existing Electron tests and concrete state checks. Disposition
IDs refer to `shared/dcs/component-disposition-catalog.ts`; the checker reads that
catalog directly. Existing scenario IDs remain owned by
`shared/agent-dev/scenarios.ts`.

## Commands

Run from the candidate checkout. The existing runtime `tsx` loader resolves the
shared TypeScript catalog; no new dependency is needed.

```powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-acceptance-matrix.mjs --check
node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-acceptance-matrix.mjs --plan --output D:/tmp/product-matrix-plan
node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-acceptance-matrix.mjs --run --group settings --output D:/tmp/product-matrix-settings
```

Each output directory must be new and outside the candidate checkout. `--group` may be repeated; omitting it selects
all groups. A batch runs every test in its selected files, without title filters.
After discovery, the runner generates the existing extension bridge and executes the Vite/runtime build entries,
records their logs and exits, checks the runtime stamp against the candidate and
hashes the build before and after Electron runs. A failed build stops execution
and leaves its test groups `not-run`.
The live provider and moyu files retain their existing resource, fresh-build,
isolation and three-trial requirements. Supply their private environment values
only to the child process.

The output includes the frozen inventory and Git identity, the discovery report,
the execution report, exact commands, exit codes and hashes. Discovery is a list
of planned tests, not execution evidence. A successful selected batch leaves
unselected journeys and additional node criteria visible in `remainingAcceptance`.
Its `selectedSuiteResult` and exit code describe that batch; `nodeAcceptance`
remains `incomplete` for the parent review. RC-10 keeps its development evidence
level. To update a frozen test hash, first review the changed cases and assertions
against the positive and negative oracles in the inventory.

## TF-0582 completion

Read the original node and
`harness/specs/tasks/product-acceptance-closeout.md#required-task-matrix` before
closing TF-0582. All nine groups need their current-candidate business outcomes
and negative controls, the three repeated live sets, a 20-minute agent exploration
record, calibrated judge rubric and reviewed P0/P1 findings. Mock UI, actual owner
effects, scripted models and live models retain their distinct evidence layers.
Windows package and final independent aggregate work remain TF-0584 and TF-0585.

README.md, README.zh-CN.md and README.ja-JP.md retain their current product
behavior; this entry documents the new developer acceptance command.
