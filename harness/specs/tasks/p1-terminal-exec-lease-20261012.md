---
id: p1-terminal-exec-lease-20261012
title: Wire the workspace exec lease into terminal execution (issue #162)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Bound Main terminal.run Gateway RPC admission with the existing workspaceExec lease and stable saturation diagnostics; do not claim OS-process or runtime-wide concurrency limits.
expectedUserBehavior:
  - Main terminal.run admits at most 2 Gateway RPC sequences per workspace; further runs queue until a slot frees.
  - Saturated terminal.run admission in one workspace does not block other workspace keys.
  - When the lease cannot be acquired within the run timeout, the user gets a stable blocked result naming the lease, not a raw rejection.
  - Windows path spellings that differ only by case or slash direction resolve to the same lease key.
touchedAreas:
  - docs/dev/p1-terminal-exec-lease-20261012/acceptance.json
  - docs/dev/p1-terminal-exec-lease-20261012/SHA256SUMS
  - electron/services/terminal-api.ts
  - electron/services/resource-leases.ts
  - shared/host-api/contract.ts
  - harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - harness/specs/tasks/stress-test-windows-concurrency-v1.md
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
  - pnpm run typecheck:web
  - pnpm contract:check
  - node scripts/check-error-governance.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/windows-high-concurrency-stability-v1.md
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-terminal-exec-lease-20261012.md
acceptance:
  - `terminal-api.ts` acquires the workspace exec lease before any Gateway exec RPC attempt, keyed by a normalized real workspace path.
  - Concurrent runs in one workspace admit at most 2 into the Gateway RPC; the third waits and proceeds after a slot frees.
  - Different workspace keys run concurrently.
  - A lease timeout returns blocked and timedOut with leaseKind, leaseKey, timeoutMs and durationMs; approved-command diagnostics classify it as timeout, not runtime failure.
  - A timed-out waiter never starts later and cannot leak a slot; thrown or rejected work releases its lease.
  - A 200-request single-workspace burst preserves FIFO, capacity 2, and nondecreasing queuedMs.
  - Archived concurrency specs distinguish the current terminal lease from unimplemented search and mutation leases and contain no requiredTests targeting missing files.
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