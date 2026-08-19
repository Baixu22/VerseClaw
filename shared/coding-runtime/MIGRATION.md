# Coding Runtime Audit Field Migration Notes

Schema version: `CODING_RUNTIME_SCHEMA_VERSION = 1`.

## Legacy source to v1 field mapping

### Existing write-journal entry (`openclaw_runtime/src/agents/tools/write-journal.ts`)

| Legacy field | v1 `CodingMutationEvent` field | Rule |
|---|---|---|
| `seq` | `mutationId` suffix or `eventId` | Keep `write-journal:<sessionId>:<seq>` as `eventId` when emitting from an existing entry. |
| `relPath` | `path` | Normalize to forward slashes; never emit an absolute host path in `path`. |
| `lineage.sessionId` | `sessionId` | Required for new v1 events. |
| `lineage.requestId` | `requestId` | Required for new v1 events. If a legacy sidecar lacks it, synthesize `legacy:<sessionId>:<seq>` and record the synthesis in the Phase 1 integration test, not silently in prod. |
| `hadPrior` | `hadPrior` | `beforeVersion`/`beforeHash` are `null` when false. |
| snapshot file content | `beforeHash`, `beforeVersion.contentHash` | Hash with sha256; store mtime/size in `beforeVersion`. |
| post-write file content | `afterHash`, `afterVersion` | `null` for delete. |
| `lineage.flags` | `flags` | Only include explicitly known boolean/string flag values. |
| `batch.state` | `phase` | `prepared` is internal batch state and is not emitted as an audit event; event phases are `committed`, `rolled_back`, or `recovery_required`. |

### Existing exec/process observations

| Legacy/current observation | v1 `CodingExecEvent` field | Rule |
|---|---|---|
| raw command string | `commandRedacted` + `commandHash` | Never copy the raw command into v1 JSONL. Use the existing redaction policy and a sha256 of the canonical command. |
| tool call id | `requestId` | Required. |
| process cwd | `cwd` and base `path` | `cwd` keeps the actual working directory; base `path` is the filterable path used by audit queries. |
| exit code / signal | `exitCode` | `null` when the process did not produce a numeric exit code. |
| workspace fingerprint before/after | base `beforeHash` / `afterHash` | One aggregate fingerprint per exec event; per-file precision lives in `sideEffects`. |

### Existing checkpoint rollback / undo_write observations

| Legacy/current observation | v1 `CodingRollbackEvent` field | Rule |
|---|---|---|
| journal batch id | `batchId` | Required. |
| per-file journal entries | `files[]` | Each outcome is `restored`, `removed`, or `restore_failed`. |
| rollback diff | `diff` | Empty string is valid for `preview: false`; previews must populate it. |
| incomplete restore | `status: "recovery_required"` | Keep the retained journal entries and point `recoveryRef` at them at the call site; the event itself must record the failure. |

## Additive migration policy

- New fields may be added in a later schema version only after the event writer
  and reader are updated together, and only as optional fields that do not
  change v1 semantics.
- `schemaVersion` must never be guessed from the presence or absence of fields.
  A reader that cannot parse `schemaVersion` must fail closed and report
  `E_AUDIT_WRITE_FAILED`, not write through.
- Old event lines are never rewritten in place. If a normalized projection is
  needed for replay, produce it at read time and keep the original JSONL byte
  sequence append-only.

## P1 write-journal sidecar additions

P1 extends the existing write-journal sidecar without rewriting old records.
All new fields are optional; a sidecar without them remains a valid P0 entry.

| Sidecar field | Meaning |
|---|---|
| `kind` | `write` / `edit` / `apply_patch` / `delete` / `move`. Absent on legacy P0 entries. |
| `targetPath` | Move destination on the source pre-image entry. |
| `moveSourcePath` | Move source on the destination pre-image entry. |
| `beforeHash` / `afterHash` | sha256 hex digest; `afterHash` is absent/`null` for delete and move-source after images. |
| `bytesBefore` / `bytesAfter` | Byte sizes for the pre/post image. |
| `beforeVersion` / `afterVersion` | `{ contentHash, mtimeMs, size }` version evidence. |

Readers must map `beforeVersion` + `beforeHash`/`bytesBefore` into v1
`CodingMutationEvent` fields. For legacy sidecars that only have the snapshot
file, the P0 v1 mapping already defines how to recompute the hash from the
snapshot bytes; P1 does not rewrite old records in place.

`CommitResult.recoveryRef` and `RollbackResult.recoveryRef` are additive and
optional (v1). They are only present for `status: "recovery_required"` and
point at the retained journal directory plus `batch` and `entries` query
fragments, e.g.
`<journalDir>#batch=<id>&entries=<comma-separated-journal-ids>`.

## P2 optimistic concurrency additions

P2 does not change the v1 event wire schema. It adds internal-only
optimistic-concurrency inputs and structured conflict output on the service
layer:

| Surface | Field | Rule |
|---|---|---|
| `CodingWriteMutation` / `CodingEditMutation` / `CodingDeleteMutation` / `CodingMoveMutation` | `baseVersion?` | Internal caller parameter; never exposed in the model-facing `write` / `edit` TypeBox schema. |
| `CodingApplyPatchMutation` | `baseVersions?` | One `FileVersion` per affected file. Checked during preflight before any target mutation. |
| `CodingRuntimeError` (`E_CONFLICT`) | `baseVersion`, `currentVersion`, `diff` | `diff` is a unified patch. When base/current content samples are unavailable it is a deterministic version-level unified diff (hash/mtime/size lines). |
| Lock timeout (`E_LOCK_TIMEOUT`) | `path` | Same structured error family; owner and lock-path diagnostics live in the message. |

`runtime.coding.uftk.baseVersionGuard.enabled` remains default `false`.
Direct internal callers may still pass `baseVersion`/`baseVersions`
explicitly; the production agent-tools wiring only activates the guard when
that flag resolves true.

## P3 exec audit and command approval additions

P3 does not change the v1 event wire schema. It adds exec-side records on the
same contract:

| Surface | Field | Rule |
|---|---|---|
| `CodingExecEvent.status` | `running` | Additive status for backgrounded exec tool starts. |
| `CodingRuntimeError` (`E_COMMAND_FORBIDDEN`) | `code` | Additive structured error for command approval `forbidden` decisions. |
| `runtime.coding.uftk.execSideEffects.enabled` | flag | Default `false`; enables bounded workspace snapshot + `sideEffects` diff in `CodingExecEvent`. |
| `runtime.coding.uftk.commandApproval.enabled` | flag | Default `false`; enables prefix policy evaluation recorded as `CodingExecEvent.approval`. |

Raw command text is still never persisted. `CodingExecEvent` carries only
`commandRedacted` and `commandHash`; side-effect paths are workspace-relative.
JSONL/SQLite audit storage remains Phase 4 work and the unified sink is
in-memory in P3.

## P4 durable audit log and replay additions

P4 does not change the v1 event wire schema. It adds durable storage behind the
same `audit-sink.ts` interface:

| Surface | Rule |
|---|---|
| `runtime.coding.uftk.auditLog.enabled` | Default `false`; when enabled together with UFTK, `FileTransactionService` and `ExecAuditor` write validated `CodingAuditEvent` records to the durable sink. |
| JSONL (`<openclaw-state>/logs/coding-audit/coding-audit.jsonl`) | Append-only audit event stream; one event per line; old lines are never rewritten; invalid tail lines are skipped with a warning and never block reading the valid prefix. |
| SQLite (`<openclaw-state>/logs/coding-audit/coding-audit.sqlite`) | Rebuildable query projection. Indexes support session / timestamp / toolName / path / redacted-command filters. Deleting the SQLite file loses no audit facts; `query` rebuilds it from JSONL. |
| Audit write policy | Events are validated through `CodingAuditEventSchema` before enqueue (fail-closed). JSONL append failures surface on `flush`/`close`; SQLite index write failures degrade with a warning because JSONL remains authoritative. |
| `listAudit` | Stays fail-closed without a P4 durable sink; with `PersistentCodingAuditSink` it queries the SQLite index and never fabricates an empty page. |
| Replay | `replay(sessionId, jsonlStore)` returns the session events in JSONL append order, which is the order tools emitted them. |

## P5 git-backed checkpoint additions

P5 does not change the v1 event wire schema or any model-facing tool schema.
It adds an opt-in git workspace checkpoint service:

| Surface | Rule |
|---|---|
| `runtime.coding.uftk.gitCheckpoint.enabled` | Default `false`; `GitCheckpointService` is disabled unless explicitly enabled. No production tool path is wired. |
| Checkpoint creation | `git stash create` style: temp `GIT_INDEX_FILE`, `git add -A` (excluding `.openclaw`), `git write-tree`, `git commit-tree`, private ref `refs/openclaw/uftk-checkpoints/<commit>`. Real index/worktree are unchanged. |
| Restore | Temp index + `git checkout-index -a -f`, real index `read-tree` to the checkpoint tree, then targeted removal of pre-restore paths absent from the target tree (preserving `.git` / `.openclaw` / lock sidecars). Never `git reset --hard` or `git clean -f`. |
| Concurrency | Restores are serialized per workspace by a process-local queue and the existing `session-write-lock` cross-process protocol, with a bounded timeout. |
| Non-git / nested .git / submodule | Structured `unsupported` result with explicit warning; no fallback dangerous operation. |
| Errors | `E_GIT_CHECKPOINT_DISABLED`, `E_GIT_CHECKPOINT_UNSUPPORTED`, `E_GIT_CHECKPOINT_NOT_FOUND`, `E_GIT_CHECKPOINT_CONFLICT`, `E_GIT_CHECKPOINT_TIMEOUT`, `E_GIT_CHECKPOINT_FAILED` are additive structured error codes. |
| Journal boundary | Git checkpoints never replace `write-journal` rollback. They snapshot/restore workspace content; mutation evidence and rollback continue to live in write-journal. |

## P6B path-scoped checkpoint, safety snapshot, and lifecycle additions

P6B does not change the v1 event wire schema or any model-facing tool schema.
The accepted P5 whole-tree `createCheckpoint()` / `restoreCheckpoint(id)`
behavior is unchanged; every new capability is additive and default-off.

| Surface | Rule |
|---|---|
| `runtime.coding.uftk.gitCheckpoint.pathScoped.enabled` | Default `false`. Gates `createCheckpoint({ paths, label })` and `restoreCheckpoint(id, { paths })`. With the flag off those calls return structured `disabled` and the whole-tree path is untouched. |
| `runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled` | Default `false`. Gates the pre-restore safety snapshot in the transactional restore. With the flag off, a restore that would destroy dirty in-scope content returns `conflict` instead of overwriting it. |
| `runtime.coding.uftk.gitCheckpoint.lifecycle.enabled` | Default `false`. Gates list-with-metadata, diff, patch export, retention/prune and GC. |
| Path-scoped create | Only the requested paths are staged into the temp `GIT_INDEX_FILE`, so the tree contains exactly the scope. The real index and worktree stay unchanged. Scope, label and parent are recorded as commit-message trailers (`openclaw-checkpoint-*`), so there is no second metadata store. |
| Path-scoped restore | Only in-scope tree paths are checked out, only in-scope extraneous paths are removed, and only those index entries are refreshed. Out-of-scope worktree content, index state and `git status` are byte-identical before and after. |
| Scope resolution | An explicit `paths` option wins; otherwise the checkpoint's own recorded scope is used. Restoring a path-scoped checkpoint is never widened into a whole-tree restore. P5 checkpoints carry no trailers and resolve to `full`. |
| Safety snapshot | Every transactional restore starts with a safety checkpoint of the affected paths (`safetyRef`) plus raw byte copies of the at-risk files (`recoveryRef`). At-risk means present on disk and either content-different from the checkpoint blob or scheduled for removal. The raw backup lives under the OpenClaw state dir, not in the workspace, so it cannot add an untracked entry and perturb `git status`. |
| Two-phase restore | `prepare` (resolve, conflict scan, safety snapshot, acquire workspace barrier + cross-process restore lock) then `apply` (the only worktree mutation) then `settle`. Prepare-stage rejection means zero change. Apply failure rolls back from the safety snapshot, or returns `recovery_required` when that rollback cannot be completed. |
| Restore barrier | With P6A `concurrencyV2` enabled, restore holds the workspace-scoped writer barrier, so new UFTK write/read prepares are excluded and existing writers drain first. The barrier alone provides that exclusion; no nested per-path locks are taken under it. |
| Worktree / submodule | A root `.git` file is resolved through `git rev-parse --git-dir` / `--git-common-dir`. A main-repository linked worktree is supported. A submodule-style link (git dir equal to the common dir) is `unsupported` with an explicit warning. A nested `.git` inside a requested scope is `unsupported`; nested repos outside the scope are explicitly reported as skipped and warned about. Whole-tree operations keep the P5 rule that any nested `.git` is `unsupported`. |
| Lifecycle | `listCheckpoints` (label/scope/parent/createdAt, newest first), `diffCheckpoints`, `exportPatch`, `retainCheckpoints(policy)`, `pruneCheckpoints`, and an explicit `collectGarbage`. Retention always keeps `protectedIds` and the newest checkpoint, so a checkpoint a caller is working against cannot be pruned away. Prune deletes refs only; object reclamation is a separate opt-in call. |
| Errors | `E_GIT_CHECKPOINT_RECOVERY_REQUIRED` is the one additive structured error code, used when an apply failed after mutating the worktree and the safety rollback could not be completed. |
| Journal boundary | Unchanged. The checkpoint modules import neither `write-journal` nor the FTS rollback path, and git checkpoints still never replace write-journal rollback. |

## P7 workflow extensions: exec undo, worktree bridge, auto checkpoint

P7 does not change the v1 event wire schema, any model-facing tool schema, or
the structured error-code enum. Every capability is additive and default-off.

| Surface | Rule |
|---|---|
| `runtime.coding.uftk.execUndo.enabled` | Default `false`. Gates undoing an exec's workspace file side effects. With the flag off the call returns structured `disabled` and touches nothing. Also requires `gitCheckpoint.pathScoped.enabled`, since the undo is a path-scoped restore. |
| `runtime.coding.uftk.autoCheckpoint.enabled` | Default `false`. Gates turn / long-task automatic checkpoints. Also requires `gitCheckpoint.pathScoped.enabled`, because an auto checkpoint without its `requestId` label is not traceable and P6B gates labels on that leaf. |
| Exec undo scope | The P3 `CodingExecEvent.sideEffects` path set becomes the restore scope. Each path is validated through the same `normalizeCheckpointScope` authority as any other scope, so workspace escapes, `.git` and `.openclaw` are rejected per-path. |
| Exec undo coverage guard | The side-effect scope must be covered by the target checkpoint's recorded scope (`scopeIsCoveredByCheckpointScope`). An uncovered path would otherwise be *deleted*, because a scoped restore treats in-scope paths absent from the tree as extraneous. Uncovered means structured `unsupported` with zero change. Narrowing to the covered subset requires an explicit `allowPartial: true` and reports the `skipped` set. |
| Exec undo completeness | `beforeHash`/`afterHash` of `null` means the exec ran without a workspace snapshot, so an empty `sideEffects` list is absence of evidence. That is reported as `unsupported`, never as `noop`. A path that cannot be proven to be a workspace file fails the whole undo rather than producing a partial one. |
| Exec undo boundary | Only workspace file side effects. Network calls, database writes, remote pushes and dependency installs are not undone and are never claimed to be. The module reads only `commandId` / `commandHash`; raw command text never enters it. |
| Worktree bridge | Restores consult `worktree-service`'s merge queue as the conflict authority and apply its `MergeConflictPolicy` to the answer. The bridge reads the queue (`getMergeQueue`) and never calls `processMergeQueue`, which would copy a worker's files into the base root as a side effect of asking. All three policies refuse the restore with zero worktree change; they differ only in the reported disposition. |
| Auto checkpoint | Labelled `uftk-auto-<trigger> <requestId>`, so a restore point always names its request. Creation never throws into the turn it precedes: every failure is a structured result plus a warning. Per-request dedupe and a `minIntervalMs` floor bound the cost. |
| Safety ref namespace | Safety refs live under `refs/openclaw/uftk-safety/`, a sibling of the checkpoint prefix. Lifecycle retention enumerates only the checkpoint prefix and asserts the namespace at each deletion, so no policy can reap a safety ref. Reclaiming them requires the explicitly named `retainSafetyCheckpoints(policy)`, and an empty policy reclaims nothing. |
| Safety snapshot of absent paths | A restore scope legitimately names files absent from disk (a deleted file being put back). `writeCheckpointCommit({ skipMissingPaths: true })` drops unmatched pathspecs so the snapshot still succeeds; `createCheckpoint` keeps the strict behavior, where naming a path that is not there is a structured failure. |
| Process start time | `getCachedProcessStartTime` provides pid-reuse detection on Linux, Windows and macOS, cached per pid. The value is an opaque platform-specific identity token, not a portable timestamp, and is only ever compared against another value from the same provider on the same host. A `null` result means "cannot prove reuse" and callers fall back to their age bound. Only the P6A cross-process marker path uses it; the accepted P1-P5 lock paths keep their existing Linux-only resolver. |
| Recovery advice | `buildCheckpointRecoveryAdvice(result)` maps a restore outcome to ordered, actionable operator steps. It is a pure function: no git, no locks, no filesystem, so it is safe to call from an already-failing path and cannot make a damaged workspace worse. Only `recovery_required` sets `actionRequired`; every other outcome guarantees a byte-unchanged worktree by construction, and advertising those as needing recovery would send an operator hunting for damage that does not exist. |
| Lock diagnostics | `inspectCodingLocks()` reports `pidReuseDetectionAvailable`, so a platform without a start-time provider is diagnosable rather than silently degraded. |
| Journal boundary | Unchanged. The P7 modules import neither `write-journal` nor the FTS rollback path. |
