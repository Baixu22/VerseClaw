# Wire the workspace exec lease into terminal execution (issue #162)

- Date: 2026-10-12
- Issue: #162
- driven_by: agent
- actor: codex
- Base: `origin/main = 8f87c6156`

## Problem

`electron/services/resource-leases.ts` implemented a FIFO `workspaceExec` lease
(capacity 2, 30s default acquire timeout, typed timeout error, idempotent
release), but it had **zero production consumers**:

- `withWorkspaceExecLease`, `acquireWorkspaceExec` and
  `isTerminalResourceLeaseTimeoutError` were only referenced inside
  `resource-leases.ts` itself.
- `electron/services/terminal-api.ts` called `gatewayManager.rpc` directly in
  `runViaOpenClawExec` with no lease.
- `tests/unit/resource-leases.test.ts` had been deleted in
  `3eb339b5d` ("remove dead orchestration modules + dead-module tests").
- `docs/dev/windows-runtime-efficiency-observability.md` and the archived
  `windows-high-concurrency-stability-v1` spec nonetheless described the lease
  as bounding terminal work.

Net effect: a single workspace had no concurrency cap on terminal execution.

## What landed

`electron/services/terminal-api.ts`:

- `resolveWorkspaceLeaseKey(path)` — `realpathSync.native` when resolvable,
  backslashes normalized to `/`, lowercased on Windows; falls back to the
  resolved path when the target does not exist yet.
- `runViaOpenClawExecWithLease(...)` — wraps `runViaOpenClawExec` in
  `withWorkspaceExecLease(leaseKey, timeoutMs, fn)`.
- Both `terminal.run` call sites (the normal path and the
  approved-dangerous-command path) now go through the lease-wrapped runner.
- A `TerminalResourceLeaseTimeoutError` is converted to a stable result:
  `{ success: false, blocked: true, reason: "...workspaceExec...", durationMs: timeoutMs }`.

`electron/services/resource-leases.ts`:

- Added `resetTerminalResourceLeasesForTest()` (and a private `resetForTest()`)
  so suites do not leak capacity across cases.

## Verification

| Gate | Command | Result |
|---|---|---|
| Terminal + lease suites | `pnpm exec vitest run tests/unit/terminal-api.test.ts tests/unit/resource-leases.test.ts` | 2 files, **18/18 passed**, exit 0 |
| Node typecheck | `pnpm run typecheck:node` | exit 0 |
| Test typecheck | `pnpm run typecheck:test` | exit 0 |
| Lint | `pnpm exec eslint <4 touched files>` | no output, exit 0 |
| Comms | `pnpm run comms:replay` + `pnpm run comms:compare` | exit 0, all PASS |
| Spec | `node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-terminal-exec-lease-20261012.md` | `Spec is valid` |

New coverage: capacity-2 admission with the third run queued behind the lease;
different workspace keys running concurrently; a typed lease timeout producing a
`blocked` result; double-release not over-freeing capacity.

`typecheck:node` needed the gitignored generated
`electron/extensions/_ext-bridge.generated.ts`; regenerating it with
`node scripts/generate-ext-bridge.mjs` resolved that unrelated failure.

## What this does not do

- It does not add `workspaceSearch` / `workspaceWriter` / `subtreeMutation` /
  `fileMutation` leases. Those kinds exist only as text in the archived specs
  and have no implementation; they are tracked by issue #167.
- It does not introduce a local shell fallback, Docker/SSH isolation, or a new
  scheduler.
- It does not change any frozen default; capacity stays at 2 and the acquire
  timeout stays 30s (overridable per call via the run timeout).

## Follow-ups

1. #167: workspace-level budgets for search / writer / subtree mutation.
2. #162 leaves `rpc-backpressure` (which only bounds `chat.history`) untouched;
   terminal execution is now bounded by the lease instead.