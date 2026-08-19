# shared/coding-runtime

P0 contract surface for the Unified File Transaction & Audit Kernel (UFTK).

Status: P1 through P7 implementations are available behind
`runtime.coding.uftk.enabled` (default `false`). P6 (unified read/write lock
scheduler, path-scoped git checkpoint v2) and P7 (exec file side-effect undo,
worktree-service bridge, auto checkpoint) are accepted with residual; no
production tool path imports or enables any of it by default. All twelve feature
flags in `DEFAULT_CODING_RUNTIME_FLAGS` remain default-off — the map is typed
`Readonly<Record<CodingRuntimeFlagKey, false>>`, so `true` is not expressible
there. Local green gates are not a GA, canary, or maturity claim.

## Files

- `types.ts` — canonical TypeScript types, event type constants, schema version,
  the `FileTransactionService` interface, `CommitResult.recoveryRef`, and the
  default-off flag catalog.
- `schema.ts` — TypeBox schemas and validators for the same contract, plus
  compile-time mutual-assignability checks that keep the two files aligned.
- `MIGRATION.md` — legacy-field migration notes required by the P0 acceptance
  gate and the P1 write-journal sidecar additions.

## Runtime implementation

- `openclaw_runtime/src/agents/coding-runtime/atomic-write.ts` — same-directory
  temp file, fsync, close, rename; no delete-then-write fallback.
- `openclaw_runtime/src/agents/coding-runtime/file-transaction-service.ts` —
  `prepare` / `commit` / `rollback` / `listAudit` over the existing write-journal.
  `listAudit` fails closed until the Phase 4 audit storage lands.
- `openclaw_runtime/src/agents/coding-runtime/rollback-preview.ts` — read-only
  unified diff preview from retained journal pre-images.
- `openclaw_runtime/src/agents/coding-runtime/file-lock-manager.ts` — P2
  per-file read-shared / write-exclusive locks. Write mode adds the existing
  `session-write-lock` sidecar protocol (backed by `infra/file-lock-manager`)
  for cross-process exclusion; multi-path locks are sorted by
  `normalizePatchLockPath` to avoid deadlocks. Timeout returns structured
  `E_LOCK_TIMEOUT`.
- `openclaw_runtime/src/agents/coding-runtime/turn-diff.ts` — P2 per-turn
  incremental unified diff (diagnostic projection only, never a state or
  journal source of truth) and version-level conflict diff rendering.
- `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts` — P2
  keeps `withFileMutationQueue(filePath, fn)` as the write mutex and adds
  `withFileReadQueue` / `{ mode: "read" }` for shared reads.
- `openclaw_runtime/src/agents/coding-runtime/exec-audit.ts` — P3
  bounded workspace file-fingerprint snapshots before/after exec and
  `CodingExecEvent` side-effect diffs.
- `openclaw_runtime/src/agents/coding-runtime/command-approval-policy.ts` —
  P3 command prefix rules with `allow` / `prompt` / `forbidden` decisions;
  longest normalized prefix wins and the default decision is `prompt`.
- `openclaw_runtime/src/agents/coding-runtime/audit-sink.ts` — P3 unified
  audit sink interface and in-memory implementation; P4 keeps this as the only
  audit-sink boundary.
- `openclaw_runtime/src/agents/coding-runtime/audit-log.ts` — P4 append-only
  JSONL audit log plus the durable `PersistentCodingAuditSink`. The JSONL is
  the authoritative event stream; the SQLite index is a rebuildable
  projection. Durable audit writes are enqueued asynchronously and drained
  with `flush`/`close`.
- `openclaw_runtime/src/agents/coding-runtime/audit-index.ts` — P4 SQLite
  query index (session / time / toolName / path / redacted command) that can
  be fully rebuilt from JSONL.
- `openclaw_runtime/src/agents/coding-runtime/replay.ts` — P4 session replay
  in JSONL append order (the same order tools emitted the events).
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint.ts` — P5
  git-backed workspace checkpoint. Creation uses the `git stash create`
  technique (temp `GIT_INDEX_FILE` + `git add -A` + `git write-tree` +
  `git commit-tree`) and stores a private ref under
  `refs/openclaw/uftk-checkpoints/<id>` without touching the real index or
  worktree. Restore uses a temp index + `git checkout-index -a -f`, targeted
  extraneous-path removal, and never `git reset --hard` or `git clean -f`.
  Restores are serialized per workspace with the existing session-write-lock
  protocol. P6B adds path-scoped create/restore (a scope-only tree, so cost
  scales with the scope rather than the repository), checkpoint metadata
  (label / scope / parent) carried in commit-message trailers, and main
  repository worktree support via `git rev-parse --git-common-dir`. Submodule
  `.git` links stay `unsupported` with an explicit warning.
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-safety.ts` — P6B
  pre-restore safety snapshot. Captures a git safety checkpoint (`safetyRef`)
  of the in-scope pre-restore state plus raw byte copies (`recoveryRef`) of the
  files a restore would actually overwrite or delete. At-risk detection is
  blob-hash exact, so cost is linear in changed in-scope files. The raw backup
  lives under the OpenClaw state dir so it cannot perturb `git status`.
  `resolveRecoveryDir` is the single definition of that location and lives here,
  next to the writer: P6B shipped a second copy in the transaction module and the
  two had already drifted on whether they resolved `stateDir`, which would have
  pointed a caller at a directory the snapshot never wrote to — on exactly the
  lookup an operator makes after `recovery_required`.
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-transaction.ts` —
  P6B two-phase restore. `prepare` resolves the plan, scans conflicts, takes the
  safety snapshot and holds the P6A workspace restore barrier plus the
  cross-process restore lock; `apply` is the only phase that mutates the
  worktree; `settle` releases and reports. A prepare-stage rejection leaves the
  target byte-unchanged, and an apply failure either rolls back from the safety
  snapshot or returns `recovery_required` with `safetyRef`/`recoveryRef`.
  It deliberately takes no per-path locks, because the barrier is a
  workspace-scope lock-core writer and therefore already excludes every UFTK
  read/write lock under the root — that exclusion is pinned end-to-end by
  `git-checkpoint-transaction.p6-seam.test.ts` rather than left to code reading,
  since if it did not hold a UFTK write could land mid-apply.
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-lifecycle.ts` —
  P6B checkpoint lifecycle: labelled listing, tree-to-tree diff, patch export,
  retention/prune, and an explicit opt-in object GC. Prune only deletes refs and
  never deletes a protected checkpoint or the newest one. P7 adds the safety-ref
  namespace split: retention enumerates only the checkpoint prefix and asserts
  the namespace at each deletion, so no policy can reap a pre-restore safety ref;
  reclaiming those needs the explicitly named `retainSafetyCheckpoints`. Ordering
  uses the millisecond stamp in the commit subject, because git's `creatordate`
  is second-resolution and cannot make "newest" well-defined for a burst.
- `openclaw_runtime/src/agents/coding-runtime/exec-side-effect-undo.ts` — P7
  undo of an exec's workspace **file** side effects: the P3
  `CodingExecEvent.sideEffects` path set becomes a path-scoped restore scope.
  Refuses, with zero change, any path set the checkpoint does not cover or that
  git cannot represent (gitignored); narrowing to the undoable subset requires an
  explicit `allowPartial` and reports what it skipped. Network, database, remote
  push and dependency-install effects are never undone and never claimed to be.
- `openclaw_runtime/src/agents/coding-runtime/checkpoint-worktree-bridge.ts` —
  P7 bridge that treats the `worktree-service` merge queue as the conflict
  authority for a restore and applies its `MergeConflictPolicy`. It reads the
  queue and never calls `processMergeQueue`, which would copy a worker's files
  into the base root as a side effect of asking. All policies refuse the restore
  with zero worktree change; they differ only in the reported disposition.
- `openclaw_runtime/src/agents/coding-runtime/auto-checkpoint.ts` — P7 turn /
  long-task automatic checkpoints, labelled with the `requestId`. Default off.
  Creation never throws into the turn it precedes, retention reuses the P6B
  lifecycle with the just-created checkpoint protected, and `withWorkspaceQuiesce`
  lets a caller wait out an in-flight restore instead of snapshotting a
  half-applied tree.
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint-recovery-advice.ts` —
  P7 operator recovery advice: a pure mapping from a restore result to ordered,
  actionable steps. No git, no locks, no filesystem, so it is safe on an
  already-failing path. Only `recovery_required` asks for action.
- `openclaw_runtime/src/shared/process-start-time.ts` — P7 cross-platform
  process start-time provider (Linux `/proc`, Windows `Get-Process`, macOS `ps`)
  with a per-pid TTL cache, so pid-reuse detection works off Linux without
  spawning a subprocess on every marker poll. Our own pid is memoized without a
  TTL, because a process cannot change its own start time and the session
  write-lock stamps that value on every acquisition. The value is an opaque
  platform-local identity token, never a portable timestamp. Callers must
  short-circuit on a dead pid before consulting it, and must read `null` as
  "cannot prove reuse" — never as "not reused". As of 2026-08-19 the P1-P5
  `session-write-lock` and `infra/stale-lock-file` paths default to it too, so
  the pid + starttime invariant is no longer Linux-only anywhere in the lock
  protocols.

## Contract invariants

1. Every `CodingMutationEvent` contains `sessionId`, `requestId`, `toolName`,
   `path`, `beforeHash`, `afterHash`, and `timestamp`.
2. `CodingExecEvent` never persists raw command text. It persists only
   `commandRedacted` and `commandHash`; per-file effects live in `sideEffects`.
3. `CodingRollbackEvent` carries a batch-level `status` of `rolled_back` or
   `recovery_required` and per-file outcomes. `recovery_required` means the
   caller must not treat the workspace as clean.
4. `FileVersion = { path, contentHash, mtimeMs, size }` is the optimistic
   concurrency unit. Paths are workspace-relative and use forward slashes.
5. JSONL audit events are an event stream, not the file-state source of truth.
   The file system plus the existing write journal remain the mutation evidence
   authority.
6. The UFTK flag set is fail-closed: every entry in
   `DEFAULT_CODING_RUNTIME_FLAGS` is `false` until its Phase gate is accepted.
   `runtime.coding.uftk.auditLog.enabled` is also default `false` (P4).
7. `CommitResult.recoveryRef` / `RollbackResult.recoveryRef` are additive and optional. It is populated only
   when rollback could not fully restore a batch and the write-journal entries
   were retained for recovery.
8. `listAudit` is fail-closed in P1/P2/P3 when no P4 durable audit sink
   is configured. It throws `E_AUDIT_WRITE_FAILED` and never pretends that an
   empty page is a successful query. With a `PersistentCodingAuditSink`
   configured it queries the SQLite index (rebuilding it from JSONL when it is
   missing).
9. `E_CONFLICT` is structured: `code`, `baseVersion`, `currentVersion`, and a
   unified `diff`. A conflict is raised during prepare, before target files
   change. `baseVersions[]` applies to `apply_patch`; model-facing tool
   TypeBox schemas remain unchanged.
10. `baseVersion` / `baseVersions` are internal caller parameters only. The
    production `runtime.coding.uftk.baseVersionGuard.enabled` flag stays
    default `false` until the P2 acceptance gate authorizes otherwise.
11. P4 durable audit storage lives under the existing OpenClaw state/log
    directory (`<openclaw-state>/logs/coding-audit`), never the workspace root,
    so it is not captured by exec side-effect snapshots or git checkpoints.
12. P5 git checkpoints are journal-independent. They never replace
    write-journal rollback; the file system + write-journal remain the
    mutation-state authority, while git checkpoints are an explicit opt-in
    workspace snapshot/restore capability.
13. P7 exec undo covers workspace **file** side effects only. Network calls,
    database writes, remote pushes and dependency installs are not undone and
    are never reported as undone. An exec event whose side-effect diff was never
    captured (`beforeHash`/`afterHash` of `null`) yields `unsupported`, not a
    `noop`: absence of evidence is not evidence of absence.
14. P7 exec undo refuses any side-effect path set the target checkpoint does not
    cover. A scoped restore removes in-scope paths absent from the checkpoint
    tree, so restoring an uncovered path would delete it. Narrowing to the
    covered subset is available but must be requested explicitly.
15. P7 pre-restore safety refs live in their own ref namespace
    (`refs/openclaw/uftk-safety/`). No checkpoint retention or prune policy can
    delete one; reclaiming them requires an explicitly named call with a
    non-empty policy.
16. P7 auto checkpoint and exec undo are both default-off and add no
    model-facing tool schema. An auto checkpoint failure is always a structured
    result, never an exception raised into the turn it precedes.
17. P7 recovery advice is a pure derivation from a restore result: no git, no
    locks, no filesystem. Only `recovery_required` asks for operator action,
    because every other restore outcome leaves the worktree byte-unchanged.

## Validation

```bash
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1
pnpm run typecheck:node
pnpm run typecheck:web
```
