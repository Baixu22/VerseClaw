---
lifecycleStatus: active
id: product-acceptance-moyu
title: Moyu coding, approval boundary, undo and recovery acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Verify that real ClawX coding tools, approval boundaries, write journal and recovery work against a disposable snapshot of the authorized moyu project, with deterministic file, test, database and trajectory oracles.
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
  - comms-regression
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - .gitignore
  - harness/specs/tasks/product-acceptance-moyu.md
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/fixtures/product-acceptance-closeout/b2-moyu/**
  - tests/e2e/product-acceptance-moyu.spec.ts
  - tests/e2e/fixtures/moyu-acceptance.ts
  - playwright.config.ts
  - scripts/repository-artifacts.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A real ClawX Chat turn reads the disposable project, fixes a deterministic apostrophe CRUD defect, runs the project's own Python tests, and renders the final explanation and file diff.
  - A real write journal can undo the turn byte-for-byte, and a missing snapshot fails explicitly without a partial restore.
  - A read-only workspace blocks mutation with no approval request or side effect, and an interrupted turn leaves no completed reply or late edit before a later turn succeeds exactly once.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec playwright test tests/e2e/product-acceptance-moyu.spec.ts --workers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm harness validate --spec harness/specs/tasks/product-acceptance-moyu.md
  - pnpm harness run --spec harness/specs/tasks/product-acceptance-moyu.md --dry-run
  - pnpm docs:policy:validate
  - pnpm repo:artifacts:check
  - pnpm repo:evidence:check
  - git diff --check
acceptance:
  - Three independent clean-profile GUI journeys each complete a real read, edit, project test verification, visible final response and byte-for-byte undo; the fixed apostrophe CRUD oracle moves from red to green and the unrelated stored validation gap does not worsen.
  - The agent cannot modify the acceptance oracle or fabricate the fix; final API state, test output, file diff, tool receipt and visible final response agree.
  - Read-only mutation denial, pre-edit cancellation and missing-journal undo fail closed; the original moyu checkout, its database and an outside sentinel stay byte-identical, and owned child processes, ports and temporary databases are reclaimed.
  - Actor and verifier roles are distinct; task success and trajectory safety are reported separately and both pass; original moyu defects and ClawX defects are listed separately.
  - A curated b2 manifest records the source snapshot, candidate commit/tree/dirty, commands, exit codes, parsed counts, actor, limitations, SHA256 and recovery index; every entry is read back from disk before closure.
docs:
  required: true
  files:
    - harness/specs/tasks/product-acceptance-closeout.md
---

# Moyu coding, approval boundary, undo and recovery acceptance

This is the TF-0581 contract under `product-acceptance-closeout`. It uses the
owner-authorized local moyu project as read-only input and never modifies the
original checkout. A run must fail closed when the source, the isolated Python
environment or the external `moyu` resource is unavailable; a required journey
must not silently skip.

## Source snapshot

The source subproject is `demo/user_api_shitcode`. Before a journey, record the
moyu Git commit, whole-repository dirty status, the included source-file list and
SHA256, and an outside sentinel hash. Copy only the audited project inputs into a
unique run-owned snapshot under `D:/tmp/clawx-product-acceptance/<run-id>/b2-moyu/`.
Do not copy `.venv`, caches, run databases, worktrees, junctions or ignored soak
data. The snapshot gets its own Git repository and baseline commit so file diffs
and exact restoration are observable.

The authorized Python environment is a read-only input used through `PATH` and
is not copied into Git. Pin-record the interpreter and the relevant package
versions in every receipt. A missing dependency environment is an infrastructure
failure; it is not a product failure and must not be rewritten as a pass.

## Frozen oracle

The run adds one labelled synthetic contract test and `pytest.ini` to the snapshot
before the baseline commit:

- create a user whose username is `O'Brien` through `POST /api/yonghu/yonghu`;
- require HTTP 200, exact username round-trip through the detail API, and isolated
  SQLite use;
- fail before the fix when the current string-built SQL returns a server error.

The test and its SHA256 are frozen before the agent turn. The agent may modify
only `demo/user_api_shitcode/user_router.py`; changing the oracle, another test,
the database, the Git baseline or a path outside the snapshot fails the journey.
The existing offline acceptance defect (`create_invalid_user` accepts invalid
input) is a pre-existing moyu finding and stays visible. Its continued failure is
not counted as a ClawX regression. The target apostrophe test must change from
red to green, and the full acceptance counts must not gain a new failure.

## Product journeys

Three tests use distinct clean Electron profiles, user-data directories and
snapshot repositories. Each test drives the real Chat UI/host bridge through the
real Gateway child, production agent runner, `read`, `edit`, `bash`/auto-verify,
write journal and `undo_write`.

Each positive journey:

1. reads the frozen oracle and the real router implementation;
2. performs the smallest edit to the allowed router path;
3. runs the project's detected Python test command through the real exec path;
4. renders a visible final response and the real file diff;
5. runs the offline acceptance command with seed `20260908`;
6. calls `undo_write`, then verifies byte-exact baseline hashes;
7. reopens the session and checks that durable transcript/state agrees with the
   final response and undo outcome.

The local model endpoint is a scripted OpenAI-compatible provider for this
acceptance only. It selects tool calls but cannot decide pass/fail; all verdicts
come from files, HTTP behavior, SQLite, process state and test exit codes.
Secrets are process-environment inputs and are never persisted in requests,
screenshots or retained evidence.

## Approval, cancellation and journal negatives

- In a separate `readOnly` workspace, a real Gateway/tool write attempt must be
  blocked with no `approvalRequired` demand and zero file effect. The denial is
  recorded as an agent-driven product boundary, not real-human approval evidence.
- An interrupted provider stream before an edit must leave the target byte-identical,
  the turn visibly failed or aborted, no completed marker, and no journal effect.
  The next turn must finish once and produce exactly one edit.
- Remove the current journal `.pre` snapshot, then call the real `undo_write`.
  The result must contain an explicit failure and recovery pointer, must not
  half-restore the file, and must preserve the journal metadata.

## Evidence and cleanup

Raw runs go to `D:/tmp/clawx-product-acceptance/<run-id>/b2-moyu/`. Curated evidence
goes to `harness/specs/fixtures/product-acceptance-closeout/b2-moyu/` and includes
`receipt.json`, per-journey timeline/state/diff/test data, a credential/path scan,
a recovery index and a complete SHA256 manifest. Keep screenshots only when they
show a product fact not covered by deterministic readback.

Before closure, read every retained artifact from disk, re-check the manifest,
confirm a later source-state hash is unchanged, and verify no owned Electron,
Gateway, Python or test process remains. If a test fails, retain the failure
receipt and keep the node open; do not delete the evidence or relax the assertion.

Every observable claim is Windows x64 source-host and agent-driven. This task
does not prove packaged/install-state behavior, general model quality, other
platforms, a release decision or real-human evidence. `releaseApproved`,
`productApproved`, `liveReady` and `defaultOn` remain false; retired Runtime Memory
flags stay retired. Do not start TF-0582 or modify the original moyu checkout.
