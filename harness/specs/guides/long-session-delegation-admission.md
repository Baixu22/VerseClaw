---
id: long-session-delegation-admission
title: Long-session delegation admission
type: guide
appliesTo:
  - long-session
  - gateway-backend-communication
---
# Long-session delegation admission

This document describes the C2 runtime-bridge contract. It records the production owner path and the meaning of the receipt returned by `hostApi.sessions.delegate()`.

## Ownership path

A delegation enters through the existing typed Host boundary:

```text
renderer / E2E
  -> hostApi.sessions.delegate()
  -> Main coordinator resolution and durable admission ledger
  -> Main gateway permission owner (workspace policy, approval, or trusted preset)
  -> Gateway orchestrator.run
  -> runOrchestrationObserved
  -> existing role-spawn / sessions_spawn / subagent registry / worktree owner
```

C2 does not introduce another executor, scheduler, Task Ledger writer, or role registry. The Task Ledger remains the only owner of task status. `taskRef` is a one-way reference to a Task Ledger node already attached to the coordinator binding.

## Admission preconditions

`sessions.delegate` requires:

- the bound Workspace is the active Main workspace;
- the C1 coordinator binding is active and ready;
- the caller's binding revision and session generation still match;
- `taskRef` is present in the binding;
- the existing Gateway permission owner authorizes the call;
- the backend is `subagent`;
- the requested worker role exists.

An expired or revoked approval is not cached as authority. A retry after the permission owner issues a new approval keeps the same deterministic admission identity while still passing back through the Gateway permission owner.

## Receipt semantics

`SessionDelegationReceipt` binds:

- coordinator Workspace, Assistant, session key, binding revision, and session generation;
- the Task Ledger task reference;
- the canonical parent environment and its revision;
- child session key and run ID;
- the actual role-spawn backend and effective tool allow/deny policy;
- shared, in-process worktree, or Git worktree isolation, including canonical root, branch, detached state, and checkout verification;
- scheduler waves and their defer reasons;
- bounded process and subagent/background-terminal facts.

An accepted child uses `runState: "accepted-not-completed"` and `completionObserved: false`. A successful spawn receipt is acceptance evidence only. Completion must arrive later from the existing subagent completion owner.

A role missing either the child session key or child run ID is rejected even if the lower spawn layer said `accepted`.

## Isolation and scheduling

A worktree request is intent, not proof. Overlapping writers run in one wave only when the existing scheduler has write-set proof or an explicitly verified checkout. Until checkout verification exists, they are deferred into serialized waves. The receipt always names the backend that actually ran, including safe fallback to in-process isolation.

## Idempotency and races

The admission identity combines the caller's idempotency key with a digest of the semantic request. The Main owner persists bounded terminal receipts in the existing application settings store.

- Duplicate submissions in one owner share one Gateway call.
- A terminal retry returns the same receipt with `replayed: true` and does not spawn again.
- Reusing an idempotency key with different semantics is rejected.
- An in-flight record left by a terminated owner becomes `outcome-unknown` with `recoveryRequired: true`; it is never retried as a new spawn.
- A parent reset during admission produces `outcome-unknown` or `rejected`, never an accepted completion claim.
- A concurrent `sessions.stop` similarly invalidates acceptance evidence.
- Unknown workers, unsupported backends, and refused launches create no accepted child receipt.

## Evidence

The C2 fixture directory contains the curated E2E receipt and the permission/isolation matrix:

```text
harness/specs/fixtures/long-session-development/c2/
```

The built Electron E2E uses isolated `userData` and run roots, launches actual Main/Gateway/runtime owners, verifies the child session, repeats the same admission within the owner and after restart, and checks stale-generation rejection.