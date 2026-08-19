---
id: coding-runtime-p6-p7-extension
title: Coding Runtime P6/P7 extension — unified concurrent lock hardening and git checkpoint v2
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend the accepted Coding Runtime P1-P5 baseline without changing model-facing tool schemas or default-on behavior. P6 delivers one unified read/write lock scheduler with cross-process shared reads, commit-time CAS, restore barriers, lock observability, and path-scoped safe git checkpoint lifecycle. P7 adds opt-in workflow extensions: exec file-side-effect undo, worktree-service merge bridge, and auto checkpoint.
touchedAreas:
  - harness/specs/tasks/coding-runtime-p6-p7-extension.md
  - docs/dev/coding-runtime-p6-p7-development-spec.md
  - docs/dev/coding-runtime-development-spec.md
  - docs/dev/handoffs/LATEST.md
  - openclaw_runtime/src/agents/coding-runtime/lock-core.ts
  - openclaw_runtime/src/agents/coding-runtime/file-lock-manager.ts
  - openclaw_runtime/src/agents/coding-runtime/lock-inspection.ts
  - openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts
  - openclaw_runtime/src/agents/coding-runtime/git-checkpoint.ts
  - openclaw_runtime/src/agents/coding-runtime/git-checkpoint-safety.ts
  - openclaw_runtime/src/agents/coding-runtime/git-checkpoint-lifecycle.ts
  - openclaw_runtime/src/agents/coding-runtime/git-checkpoint-transaction.ts
  - openclaw_runtime/src/agents/coding-runtime/exec-side-effect-undo.ts
  - openclaw_runtime/src/agents/coding-runtime/checkpoint-worktree-bridge.ts
  - openclaw_runtime/src/agents/coding-runtime/auto-checkpoint.ts
  - openclaw_runtime/src/agents/coding-runtime/git-checkpoint-recovery-advice.ts
  - openclaw_runtime/src/agents/coding-runtime/*.test.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/shared/process-start-time.ts
  - openclaw_runtime/src/shared/process-start-time.test.ts
  - openclaw_runtime/src/agents/session-write-lock.ts
  - openclaw_runtime/src/infra/stale-lock-file.ts
  - openclaw_runtime/src/infra/stale-lock-file.test.ts
  - openclaw_runtime/src/context-engine/coding-observability.ts
  - openclaw_runtime/src/context-engine/coding-runtime-flags.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - shared/coding-runtime/types.ts
  - shared/coding-runtime/schema.ts
  - shared/coding-runtime/README.md
  - shared/coding-runtime/MIGRATION.md
  - tests/unit/coding-runtime-contract.test.ts
  - tests/unit/config-schema-parity.test.ts
  - reports/CODING-RUNTIME-P6*
  - reports/CODING-RUNTIME-P7*
expectedUserBehavior:
  - With all flags off, write/edit/apply_patch/exec and git checkpoint behavior is byte-identical to the accepted P1-P5 baseline.
  - When concurrencyV2 is explicitly enabled, same-file reads run concurrently in-process and cross-process, writers exclude readers and writers, lock wait has timeout/owner/stale diagnostics, and a restore barrier prevents new mutation prepares while a restore is in progress.
  - When gitCheckpoint path-scoped and safety flags are explicitly enabled, path-scoped restore only touches requested paths, unrelated dirty WIP remains untouched, and pre-restore dirty content is preserved in a safety checkpoint or returned as recoveryRef on conflict.
  - Git restore still never uses `git reset --hard` or `git clean -f`; non-git and unsupported nested .git/submodule cases return structured unsupported with explicit warning.
  - P7 exec undo only restores workspace file side effects recorded by the accepted P3 audit path and returns structured unsupported for anything else.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - coding-runtime-workspace-dcs-producer-boundary
  - coding-mutation-consistency-boundary
  - active-config-guards
  - contract-first-boundary
  - docs-sync
  - backend-communication-boundary
  - runtime-local-ecosystem-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md
  - pnpm harness validate --spec harness/specs/tasks/coding-runtime-p6-p7-extension.md --no-diff
  - pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/coding-runtime/file-lock-manager.test.ts src/agents/coding-runtime/file-lock-manager.xproc-read.test.ts src/agents/coding-runtime/lock-core.test.ts src/agents/coding-runtime/lock-core.fairness.test.ts src/agents/coding-runtime/lock-inspection.test.ts src/agents/coding-runtime/file-transaction-service.concurrency.test.ts src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts src/agents/sessions/tools/file-mutation-queue.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/coding-runtime/git-checkpoint.test.ts src/agents/coding-runtime/git-checkpoint.restore.test.ts src/agents/coding-runtime/git-checkpoint.scoped.test.ts src/agents/coding-runtime/git-checkpoint-safety.test.ts src/agents/coding-runtime/git-checkpoint-lifecycle.test.ts src/agents/coding-runtime/git-checkpoint-safety-retention.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/coding-runtime/git-checkpoint-transaction.p6-seam.test.ts --maxWorkers=1 --reporter=verbose
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/coding-runtime/exec-side-effect-undo.test.ts src/agents/coding-runtime/exec-side-effect-undo.ignored-probe.test.ts src/agents/coding-runtime/checkpoint-worktree-bridge.test.ts src/agents/coding-runtime/checkpoint-worktree-bridge.leak-probe.test.ts src/agents/coding-runtime/auto-checkpoint.test.ts src/agents/coding-runtime/git-checkpoint-recovery-advice.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.shared-core.config.ts src/shared/process-start-time.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-embedded-agent.config.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/coding-runtime --maxWorkers=1 --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm contract:check
  - pnpm run lint:bom
  - pnpm run lint:dcs
  - git diff --check
  - pnpm verseshell:test
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1
acceptance:
  - P6A must land before P6B restore transaction work. P6A evidence proves one unified process-local scheduler is used by write/edit/apply_patch/FTS, cross-process shared reads exclude writers, multi-path locks are deadlock-free, and lock contention/timeout/stale metrics increase under real contention tests.
  - Commit-time CAS recheck returns structured E_CONFLICT with baseVersion/currentVersion/diff and leaves targets zero-changed. Model-facing TypeBox schemas for write/edit/apply_patch/exec remain unchanged.
  - P6B path-scoped create/restore proves scope outside paths are byte-identical by git status and file hash; scoped restore is serialized with UFTK writers through the P6A barrier.
  - Every restore starts with a safety snapshot for affected paths. Conflict or mid-apply failure returns structured conflict/failed/recovery_required with safetyRef/recoveryRef and never silently discards user content.
  - Git checkpoint lifecycle supports label/list/diff/exportPatch/retention/prune without deleting the currently referenced checkpoint; no `git reset --hard` or `git clean -f` appears in implementation or tests.
  - Non-git, root .git worktree link, and submodule cases have explicit structured results and warnings. Submodule support is either explicit recursion behind a flag or unsupported; silent partial support is prohibited.
  - P7 exec undo consumes only CodingExecEvent.sideEffects paths, rejects workspace-external and non-file effects, and does not promise rollback of network/database/remote push effects. A side-effect path the checkpoint does not cover, or that git cannot represent (gitignored), is refused with zero change rather than silently left un-reverted; narrowing to the undoable subset requires an explicit allowPartial and reports what it skipped.
  - P7 worktree bridge uses worktree-service merge queue/conflict policy instead of creating a new merge system; auto checkpoint stays default-off with retention and requestId labels. The bridge reads the queue and never calls processMergeQueue, and it must release the workspace barrier on any failure between prepare and apply.
  - Pre-restore safety refs live in their own ref namespace and no checkpoint retention/prune policy may delete one; reclaiming them requires an explicitly named call with a non-empty policy.
  - Checkpoint ordering used by retention has sub-second resolution, so "the newest checkpoint is always protected" holds for a burst of checkpoints created inside one second.
  - All new flags default false and are synchronized across config type/zod/leaves/runtime flag resolver/shared contract/dcs default gate. Product locks remain false.
  - Residual rules from the full acceptance prompt remain authoritative, with the external-workstream carve-out recorded in docs/dev/coding-runtime-p6-p7-development-spec.md section 7: tsgo:core:test may show the three pre-existing RLG WIP test files plus goal-wake-runtime.test.ts, which does not consume the P6/P7 residual budget and must never include a P6/P7 file; config-schema-parity may only show runtime.memory.candidateGeneration; any other failure blocks acceptance.
  - harness validate is run with --no-diff. Diff-mode changed-path ownership cannot pass in a working tree carrying unrelated workstream changes, and declaring those foreign paths as touchedAreas/residualPaths would falsify ownership.
  - The user-facing READMEs listed under docs.files are synchronized only when P6/P7 changes user-visible behavior, per the design spec section 12 item 5. With every flag default-off and no production tool path importing these modules, there is no user-visible change, so leaving README.md / README.zh-CN.md / README.ja-JP.md untouched is the correct outcome, not a missed docs-sync. Documenting an off, unwired capability in a user-facing README would itself violate the "no GA / canary / maturity claim" rule.
  - A combined P6 acceptance report is required in addition to the P6A and P6B reports, and must carry evidence that single-phase acceptance cannot produce: the A-to-B seam (a real two-phase restore versus real per-path UFTK locks) and an A-union-B regression in one process.
docs:
  required: true
  files:
    - docs/dev/coding-runtime-p6-p7-development-spec.md
    - docs/dev/coding-runtime-development-spec.md
    - docs/dev/handoffs/LATEST.md
    - shared/coding-runtime/README.md
    - shared/coding-runtime/MIGRATION.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Coding Runtime P6/P7 Extension

This is the single executable harness spec for the planned P6/P7 extension. The
canonical design authority is
`docs/dev/coding-runtime-p6-p7-development-spec.md`. This file only pins scope,
ordering, and gates; it does not replace the original
`docs/dev/coding-runtime-development-spec.md`.

## Design Authority

The accepted P1-P5 implementation remains the baseline. P6/P7 may extend the
existing `coding-runtime` modules but must keep the original contract invariants:
write-journal and file system remain the mutation state authority, JSONL remains
the audit event stream, SQLite stays a rebuildable projection, and git checkpoints
never replace write-journal rollback.

## Start Gate

P6 starts only after:

- `TF-0075` is ready;
- this harness spec validates;
- `docs/dev/coding-runtime-p6-p7-development-spec.md` is present and reviewed;
- P1-P5 full acceptance remains ACCEPT_WITH_RESIDUAL with flags and product locks unchanged.

If any start gate is missing, report BLOCKED. Do not create new production
wiring, new model schemas, or default-on behavior to work around the gate.

## Scope Sequence

1. P6A: unified lock scheduler, cross-process shared read protocol, multi-path
   and directory/workspace locks, commit CAS, lock observability.
2. P6B: path-scoped git checkpoint, safety snapshot, two-phase restore,
   checkpoint lifecycle, worktree/submodule policy.
3. P6 independent acceptance: A then B, then combined P6 regression.
4. Only after user confirms P6: P7 C (exec undo, worktree bridge, auto
   checkpoint) may start.

## Completion Rule

Each phase produces its own evidence and acceptance report under `reports/`.
The next phase may not start until the previous phase has an independent
acceptance result accepted by the user and the task-forest node is updated
through proposal apply/validate/export.

## Hard Contract

- No `git reset --hard`, no `git clean -f`.
- No second lock system, queue, journal, or audit sink.
- No model-facing tool schema changes.
- No default-on flags; no product-lock changes.
- No silent loss of user workspace content during restore.
- No claim of UFTK GA / canary / overall maturity from local green gates.
