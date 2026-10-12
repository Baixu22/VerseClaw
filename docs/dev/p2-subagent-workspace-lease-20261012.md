# Workspace-level resource leases for agent tools (issue #167)

- Date: 2026-10-12
- Issue: #167
- driven_by: agent
- actor: codex
- Base: `origin/main = 91c0fda7d`
- Spec: `harness/specs/tasks/p2-subagent-workspace-lease-20261012.md`

## Problem

Subagent fan-out is bounded at the lane level (`subagents.maxConcurrent = 8`,
`server-lanes.ts`) and the agent level (`maxChildrenPerAgent = 5`), but nothing
bounded how many subagents in **one workspace** hit the same file tree or
process table at once. Issue #162 wired the Main-process `workspaceExec` lease
into `terminal.run`, but that lease lives in the Electron Main process and
cannot govern agent tools, which spawn inside the gateway/runtime process.

`git grep "workspaceSearch|workspaceWriter|subtreeMutation|fileMutation"`
matched only design text before this change. The only effective workspace-level
serialization was `file-mutation-queue.ts` (same real file only), used by `edit`
and `write`; search and terminal work were unbounded.

## What landed

`openclaw_runtime/src/agents/resource-leases.ts` — a runtime-side lease kernel:

| kind | capacity | mode |
|---|---|---|
| `workspaceExec` | 2 | semaphore per key |
| `workspaceSearch` | 2 | semaphore per key |
| `workspaceWriter` | 1 | semaphore per key |
| `subtreeMutation` | 1 | path (subtree conflict) |
| `fileMutation` | 1 | path (file conflict) |

- Per `(kind, key)` FIFO queue; strict ordering so later waiters cannot jump an
  earlier conflicting one.
- `normalizeWorkspaceLeaseKey` (`realpathSync.native` when resolvable,
  `/`-separated, lowercased on Windows) so case/slash/realpath variants of one
  workspace share one budget. Falls back to the resolved path for missing
  targets.
- Bounded acquisition (`timeoutMs`, default 30s; `<= 0` waits indefinitely).
  A waiter that cannot be admitted in time is rejected with a typed
  `ResourceLeaseTimeoutError` carrying `leaseKind`, `leaseKey`, `queuedMs` and
  `timeoutMs` — fail-closed with diagnostics instead of queueing forever.
- Idempotent release; release runs in a `finally`, and a timed-out waiter is
  removed from the queue without touching active slots.

Production wiring:

- `createLocalBashOperations().exec` wraps the whole child lifetime in
  `workspaceExec`.
- `createGrepToolDefinition` / `createFindToolDefinition` wrap the whole
  ripgrep / fd run in `workspaceSearch` (the lease-free builders stay available).
- `withFileMutationQueue` (the `write` / `edit` path) now delegates to the
  `fileMutation` kind instead of a second per-file scheduler; same-file writes
  serialize, disjoint files run in parallel.

## Boundary

- **Per runtime process.** It does not bound OS processes, remote work, other
  runtime processes, or the Electron Main process. Main `terminal.run` keeps its
  own `workspaceExec` lease from #162; the two are independent because they live
  in different processes.
- **No frozen-default change:** `maxChildrenPerAgent` / `subagents.maxConcurrent`
  are untouched.
- **`workspaceWriter` / `subtreeMutation` have no production call site yet.**
  There is no whole-workspace agent operation and no delete / rename / move agent
  tool, so wiring them now would create an unwired module. They are part of the
  kernel surface and are covered by unit tests; the archived concurrency specs
  were corrected to say so instead of claiming the budgets already existed.
- **`fileMutation` keeps the original unbounded same-file wait** (`timeoutMs 0`)
  so a legitimate long write is not failed by the lease; only the new
  search/exec gates use the 30s default.
- **No performance claim.** A stored before/after artifact pair from an
  agent-driven run would be required to assert any improvement.

## Why runtime-side rather than extending `electron/services/resource-leases.ts`

The issue suggested extending the Main lease kernel, but the two are separate
TypeScript projects (`tsconfig.node.json` includes `electron`/`shared`;
`openclaw_runtime/tsconfig.json` includes `src`/`packages`) and run in separate
processes. Agent tools spawn in the gateway/runtime process, so a Main-process
in-memory semaphore cannot admit them. This kernel mirrors the Main kernel's
FIFO + capacity + timeout structure rather than introducing a third design.

## Verification

Gate commands, exact counts and artifact hashes are recorded in
`docs/dev/p2-subagent-workspace-lease-20261012/acceptance.json`.
