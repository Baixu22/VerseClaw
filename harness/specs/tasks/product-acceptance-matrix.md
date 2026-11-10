---
lifecycleStatus: active
id: product-acceptance-matrix
title: Core product journey matrix and candidate-bound execution
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Give TF-0582 a reproducible nine-group inventory and compare its frozen Playwright collection with actual results, preserving missing, failed, skipped and stale evidence.
diffBase: 949757ca18f33df01e385c5d5c98855547a2ecba
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/product-acceptance-matrix.md
  - harness/specs/fixtures/product-acceptance-matrix/**
  - scripts/product-acceptance-matrix.mjs
  - scripts/product-acceptance-matrix.d.mts
  - scripts/product-matrix-judge.mjs
  - scripts/product-matrix-judge.d.mts
  - tests/unit/product-acceptance-matrix.test.ts
  - openclaw_runtime/src/entry.ts
  - openclaw_runtime/src/infra/source-doctor.ts
  - openclaw_runtime/src/infra/source-doctor.test.ts
  - tests/e2e/fixtures/product-candidate.ts
  - tests/e2e/fixtures/space-bunny-responses.ts
  - tests/e2e/fixtures/fp-p1-harness.ts
  - tests/e2e/fixtures/session-task-chain.ts
  - tests/e2e/product-acceptance-space-bunny.spec.ts
  - tests/e2e/product-matrix-delegation.spec.ts
  - tests/e2e/product-matrix-doctor.spec.ts
  - tests/e2e/knowledge-review-queue.spec.ts
  - tests/e2e/product-matrix-memory.spec.ts
  - tests/e2e/product-matrix-knowledge.spec.ts
  - tests/e2e/product-matrix-tools.spec.ts
  - tests/exploration/product-matrix.config.ts
  - tests/exploration/product-matrix.session.spec.ts
  - harness/specs/tasks/product-acceptance-space-bunny.md
  - tests/e2e/support-bundle-fp-p1-06.spec.ts
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
  - node node_modules/@playwright/test/cli.js test --config tests/exploration/product-matrix.config.ts --list
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts src/infra/source-doctor.test.ts --maxWorkers=1
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
  - The support-bundle journey retains the sanitized bundle in test output before its temporary profile is removed.
  - Successful pnpm Vite/runtime builds produce the fresh-build proof consumed by the provider suite, using a shared source/build digest; altered inputs, failed commands and preflight overrides cannot pass matrix acceptance.
  - Serial batches may reuse a sealed build only after matching the clean candidate, runtime stamp, source/build digest and successful build receipts; the original proof is retained byte-for-byte and rechecked for planning-time drift.
  - The outer execution budget includes collected timeouts and literal overrides inside frozen test bodies plus fixture cleanup; missing, unbounded or dynamic timeouts fail before execution.
  - The qualitative judge reuses the frozen clarity rubric, calibrates pass/fail/unknown fixtures on the current model and retains three distinct response receipts per sample; unavailable votes remain unverified.
  - Three clean-profile cancellation trials resume the same session, preserve the aborted run, exclude delayed frames and finish the later reply without a new tool effect.
  - The isolated exploration session records at least twenty minutes of agent interaction, twenty-five actions, all ten charter states, screenshots, console output and reviewed findings against the same sealed build.
  - Credential redaction preserves task identifiers and artifact paths so the frozen rubric and source-input manifests can be read back.
  - Knowledge layout checks follow the current knowledge-bot-avatar contract: a bounded nonmodal conversation keeps the library URL and editor mounted, closes on Escape and restores launcher focus without losing the draft.
  - Source Doctor waits for diagnostic or migration output to flush and exits with the command result, including 1 for malformed configuration, instead of remaining alive until the host timeout.
docs:
  required: true
  files:
    - harness/specs/tasks/product-acceptance-matrix.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
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
node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-acceptance-matrix.mjs --run --group knowledge --build-proof D:/tmp/product-matrix-settings/fresh-build-proof.json --output D:/tmp/product-matrix-knowledge
```

Each output directory must be new and outside the candidate checkout. `--group` may be repeated; omitting it selects
all groups. A batch runs every test in its selected files, without title filters.
After discovery, the runner executes `pnpm run build:vite` and `pnpm run build:runtime`,
including the existing lifecycle hooks, and records their logs and exits. It checks
the runtime stamp, hashes the source/build inputs and writes `fresh-build-proof.json`.
The provider suite consumes that proof through `CLAWX_SPACE_BUNNY_BUILD_PROOF` and
uses the same file traversal and digest implementation. The runner rechecks those
inputs after Electron runs. A failed build stops execution and leaves its test
groups `not-run`. Matrix acceptance rejects preflight/operational overrides and
the fault-case selection variable, keeping all required negative controls enabled.
When present, the VerseShell/VerseGit manifests and binaries are included in the
same input digest and rechecked after execution. The tools group requires the
qualified binaries declared by those manifests; a missing binary is an incomplete
test prerequisite, and its skipped case fails the matrix.
For later serial groups, `--build-proof` validates an existing proof against the
current clean candidate, runtime stamp and source/build digest. It retains the
proof bytes and original path/hash in the new batch, and skips both build commands.
`execution-budget.json` records each collected timeout and the maximum literal
`test.setTimeout` or `testInfo.setTimeout` in that frozen file. Test-body overrides
are not executed by Playwright discovery, so the outer budget uses the larger value
per case and reserves a separate slot of that size for afterEach/test-fixture teardown,
with a minimum of the project's 90 seconds. It adds 90 seconds per case for worker cleanup
and 180 seconds for final reporting. Each case keeps its declared timeout. Missing collection timeouts and
zero or dynamic override values stop the batch.
The live provider and moyu files retain their existing resource, fresh-build,
isolation and three-trial requirements. Supply their private environment values
only to the child process. Provider and moyu receipts are retained under the batch's
`b1-space-bunny/` and `b2-moyu/` directories. Installed dependencies are reused;
`PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` prevents pnpm from replacing them.

The output includes the frozen inventory and Git identity, the discovery report,
the execution report, exact commands, exit codes and hashes. `execution.stdout.txt`
also records live per-case progress through Playwright's line reporter. Discovery is a list
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

## Qualitative review

`judge-rubric.json` freezes the existing `tf0590-clarity/v2` prompt and six calibration
samples by SHA256. `scripts/product-matrix-judge.mjs` runs three Responses votes per
sample on the authorized space-bunny resource. It keeps raw requests/responses,
identities and hashes; duplicate responses, incomplete output and model drift make
the sample unavailable. File, database, process and runtime-state oracles continue
to determine each business outcome.

```powershell
node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-matrix-judge.mjs --calibrate --output D:/tmp/product-matrix-judge
node --import ./openclaw_runtime/node_modules/tsx/dist/loader.mjs scripts/product-matrix-judge.mjs --review D:/tmp/product-matrix-review-samples.json --output D:/tmp/product-matrix-review
```

Review input is an array of `{ "id": "...", "facts": { ... }, "explanation": "..." }`
from retained outcome artifacts. Each review run first recalibrates the frozen
samples. A review `unknown` is recorded as `unverified`; the node remains subject
to the complete TF-0582 evidence gate.

## Agent exploration

The separate `tests/exploration/product-matrix.config.ts` entry keeps the interactive
twenty-minute charter outside ordinary E2E discovery. It reuses the Electron isolation
fixture and local scripted provider, exposes only that fixture's loopback CDP port in
`session.json`, and retains the console and final candidate binding. The executing agent
uses the existing Playwright/CDP API to inspect navigation, keyboard focus, light/dark
themes, narrow layout, drafts, empty/error states and return/reopen flows. Screenshots
and action observations accompany `agent-review.json`; unresolved P0/P1 findings fail
the run. The session fixture owns shutdown after reviewing that record.

```powershell
node node_modules/@playwright/test/cli.js test --config tests/exploration/product-matrix.config.ts --workers=1 --retries=0 --reporter=json --output D:/tmp/product-matrix-exploration
```

Supply `CLAWX_SPACE_BUNNY_BUILD_PROOF` from the current matrix build and use the
isolated `CLAWX_E2E_RUN_ROOT_BASE`. `session.json` lists the required states and output
directory. The review records its `runId`, actual `startedAt`/`finishedAt` timestamps,
`visitedStates`, at least twenty-five `actions`, and findings with `priority`/`status`.
