---
id: p1-terminal-exec-lease-20261012
title: Wire the workspace exec lease into terminal execution (issue #162)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Make the already-implemented workspaceExec lease actually bound terminal execution, so one workspace cannot exceed its concurrency cap and a saturated workspace returns a stable diagnostic instead of an unbounded fan-out.
expectedUserBehavior:
  - Terminal executions from one workspace run at most 2 at a time; further runs queue and proceed as slots free.
  - Terminal executions in different workspaces do not block each other.
  - When the lease cannot be acquired within the run timeout, the user gets a stable blocked result naming the lease, not a raw rejection.
  - Windows path spellings that differ only by case or slash direction resolve to the same lease key.
touchedAreas:
  - electron/services/terminal-api.ts
  - electron/services/resource-leases.ts
  - tests/unit/terminal-api.test.ts
  - tests/unit/resource-leases.test.ts
  - harness/specs/tasks/p1-terminal-exec-lease-20261012.md
  - docs/dev/p1-terminal-exec-lease-20261012.md
  - docs/dev/windows-runtime-efficiency-observability.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/terminal-api.test.ts tests/unit/resource-leases.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-terminal-exec-lease-20261012.md
acceptance:
  - `terminal-api.ts` acquires the workspace exec lease before any Gateway exec RPC attempt, keyed by a normalized real workspace path.
  - Concurrent runs in one workspace admit at most 2 into the Gateway RPC; the third waits and proceeds after a slot frees.
  - Different workspace keys run concurrently.
  - A lease timeout returns a blocked result (`blocked: true`) whose reason names the workspaceExec lease, with `durationMs = timeoutMs`.
  - Release happens in a `finally` path; a double release does not free a second slot.
  - No local shell fallback is introduced and no frozen default is changed.
docs:
  required: true
  paths:
    - docs/dev/p1-terminal-exec-lease-20261012.md
---

# Wire the workspace exec lease into terminal execution

`electron/services/resource-leases.ts` implemented a FIFO `workspaceExec` lease
(capacity 2, 30s default timeout), but nothing called it: `withWorkspaceExecLease`
had zero production consumers and `terminal-api.ts` went straight to
`gatewayManager.rpc`. The durable doc and the archived
`windows-high-concurrency-stability-v1` spec described the lease as if it were
wired, which was not true.

This change closes that gap at the real exec boundary:

- `runViaOpenClawExecWithLease` wraps `runViaOpenClawExec` in
  `withWorkspaceExecLease`, so both `terminal.run` call sites (normal and
  approved-dangerous) acquire a slot before touching Gateway.
- The lease key is a normalized real path: `realpathSync.native` when the target
  exists, slash-normalized, lowercased on Windows, so case and slash variants
  map to one key.
- A `TerminalResourceLeaseTimeoutError` becomes a stable
  `{ success: false, blocked: true }` result instead of an unhandled rejection.

It deliberately does not add the `workspaceSearch` / `workspaceWriter` /
`subtreeMutation` / `fileMutation` kinds that the archived spec listed as
expected; those have no implementation and are tracked separately (issue #167).