# VerseShell P2-01 Read-only Facade Evidence (2026-08-14)

Status: engineering evidence only. P2-01 remains explicit opt-in and fail-closed; it does not
enable canary traffic, writes, command profiles, provider usage, default-on, GA, or product approval.
The locks remain `default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## Scope

`read_file`, `search_content`, and `result_query` are now materialized only from the stable
`shared/verseshell/facade.ts` catalog and only when `verifiedRuntime`, `typedAci`, `facade`,
`governedExec`, and `artifactResults` are all explicitly enabled. The adapter reuses the host-owned
`VerseShellAciClient` and supervised process manager; it does not spawn processes, call MCP or
Gateway HTTP, or implement a native fallback.

Read and search inputs are workspace-relative and bounded. Absolute paths, `..` escapes, NULs,
unbounded windows, glob/query sizes, and result-query ranges fail closed. `file.view`, `repo.search`,
and `result.query` are the only ACI operations used. Read/search cache keys include workspace
identity, revision, policy digest, operation, and canonical arguments, with bounded TTL and capacity.
Artifact handles and descriptors are validated, including digest, retention, and expected workspace
owner lineage.

## Focused Verification

| Check | Result |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p2-readonly-facade.md` | PASS |
| `pnpm harness validate --spec ...` | BLOCKED by unrelated shared-worktree ownership paths; no bypass used |
| `pnpm harness validate --no-diff --spec harness/specs/tasks/verseshell-p2-readonly-facade.md` | PASS |
| VerseShell Vitest config | 13 files / 71 tests PASS |
| `pnpm exec vitest run tests/unit/verseshell-readonly-facade.test.ts --maxWorkers=1` | 3/3 PASS |
| `pnpm run typecheck:node` | PASS |
| `pnpm run comms:replay` | PASS |
| `pnpm run comms:compare` | PASS |
| `git diff --check` | PASS |

The focused runtime tests cover default-off and kill-switch absence, explicit readiness, tool
surface order, path traversal and absolute/NUL rejection, bounded ACI operation mapping, cache
identity isolation, cache expiry/capacity, malformed result handles, and artifact owner drift.

## Residuals and Next Gate

The normal diff-aware harness validator sees unrelated pre-existing changes across the shared
worktree and cannot establish ownership for this isolated spec. This is retained as an environment
residual, consistent with earlier foundation packages. A clean candidate worktree is required for
release-quality diff-aware validation.

P2-02 command profiles are not started. No write adapter, journal mutation, native fallback,
provider-backed canary, or rollout lock change is authorized by this evidence.
