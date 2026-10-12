---
id: p2-subagent-workspace-lease-20261012
title: Add workspace-level resource leases for agent tools (issue #167)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Bound concurrent agent-tool workspace contention (exec / search / file mutation) inside one runtime process with a workspace-keyed lease kernel; do not claim OS-process limits, lane-level changes, or frozen-default changes.
expectedUserBehavior:
  - At most 2 command executions per workspace run at once; further exec waits for a slot.
  - At most 2 workspace searches per workspace run at once; the third records a positive queuedMs.
  - Overlapping file mutations serialize while disjoint file mutations run in parallel.
  - Different workspace keys never block one another.
  - A saturated lease that cannot be acquired within its timeout fails with a typed ResourceLeaseTimeoutError naming leaseKind / leaseKey / queuedMs / timeoutMs instead of queueing forever.
touchedAreas:
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/agents/resource-leases.test.ts
  - openclaw_runtime/src/agents/sessions/tools/bash.ts
  - openclaw_runtime/src/agents/sessions/tools/bash-workspace-lease.test.ts
  - openclaw_runtime/src/agents/sessions/tools/grep.ts
  - openclaw_runtime/src/agents/sessions/tools/find.ts
  - openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts
  - harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - harness/specs/tasks/stress-test-windows-concurrency-v1.md
  - docs/dev/p2-subagent-workspace-lease-20261012.md
  - docs/dev/p2-subagent-workspace-lease-20261012/acceptance.json
  - docs/dev/p2-subagent-workspace-lease-20261012/SHA256SUMS
  - docs/dev/windows-runtime-efficiency-observability.md
  - scripts/repository-artifacts.json
  - harness/specs/tasks/p2-subagent-workspace-lease-20261012.md
  - .gitignore
requiredRules:
  - backend-communication-boundary
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.core.json
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/resource-leases.test.ts src/agents/sessions/tools
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-subagent-workspace-lease-20261012.md
acceptance:
  - Three concurrent workspace searches for one key run at most 2 at a time and the third records queuedMs > 0.
  - Overlapping file mutations on the same key serialize; disjoint file-mutation keys run in parallel.
  - Overlapping subtree-mutation keys serialize; disjoint subtrees run in parallel.
  - Different workspace keys are independent.
  - Eight concurrent workspace exec acquisitions for one key peak at the workspace budget (2), not the lane budget.
  - Release is idempotent and a timed-out waiter leaks no slot.
  - The runtime core typechecks and the lease + agent-tool suites pass.
docs:
  required: true
  paths:
    - docs/dev/p2-subagent-workspace-lease-20261012.md
---

# Add workspace-level resource leases for agent tools

Subagent fan-out is bounded at the lane level (`subagents.maxConcurrent = 8`)
and the agent level (`maxChildrenPerAgent = 5`), but nothing bounded how many
subagents in **one workspace** hit the same file tree or process table at once.
Issue #162 wired the Main-process `workspaceExec` lease into `terminal.run`, but
that lease lives in the Electron Main process and cannot govern agent tools,
which spawn inside the gateway/runtime process.

This change adds a runtime-side lease kernel
(`openclaw_runtime/src/agents/resource-leases.ts`) with the five kinds the
archived concurrency specs described:

| kind | capacity | mode |
|---|---|---|
| `workspaceExec` | 2 | semaphore per key |
| `workspaceSearch` | 2 | semaphore per key |
| `workspaceWriter` | 1 | semaphore per key |
| `subtreeMutation` | 1 | path (subtree conflict) |
| `fileMutation` | 1 | path (file conflict) |

Keys are normalized with `normalizeWorkspaceLeaseKey` (`realpath` when
resolvable, `/`-separated, lowercased on Windows) so case and slash variants of
one workspace share a single budget. Acquisition is FIFO with a bounded timeout;
a waiter that cannot be admitted in time is rejected with a typed
`ResourceLeaseTimeoutError` carrying `leaseKind`, `leaseKey`, `queuedMs` and
`timeoutMs`. Release is idempotent and a timed-out waiter never leaks a slot.

Production wiring:

- `createLocalBashOperations().exec` acquires `workspaceExec` for the whole
  child lifetime.
- `createGrepToolDefinition` / `createFindToolDefinition` acquire
  `workspaceSearch` for the whole ripgrep / fd run.
- `withFileMutationQueue` (used by the `write` and `edit` tools) now delegates to
  the `fileMutation` kind instead of a second per-file scheduler.

`workspaceWriter` and `subtreeMutation` are part of the kernel surface and are
covered by unit tests, but have no production call site yet: there is no
whole-workspace agent operation and no delete / rename / move agent tool, so
wiring them now would be an unwired module. The archived specs were corrected to
say so instead of claiming the budgets already existed.

## Boundary

- One runtime process only. It does not bound OS processes, remote work, other
  runtime processes, or the Electron Main process; Main `terminal.run` keeps its
  own `workspaceExec` lease from #162.
- It does not change `maxChildrenPerAgent` / `subagents.maxConcurrent`, add
  Docker/SSH isolation, or introduce a third scheduler.
- `fileMutation` keeps the original unbounded same-file wait (timeout `<= 0`); it
  does not fail a legitimate long-running write.
- No performance claim: a stored before/after artifact pair would be required.
