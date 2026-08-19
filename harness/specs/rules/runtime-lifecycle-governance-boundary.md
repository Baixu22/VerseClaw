---
id: runtime-lifecycle-governance-boundary
title: Runtime Lifecycle Governance Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# Runtime Lifecycle Governance Boundary

## Authority

- OpenClaw runtime owns session identity, lifecycle mutation, admission, process cleanup, goal
  truth, wait truth, and process-run truth.
- Session store is per-agent SQLite `cache_entries`; Electron never mutates it.
- Electron owns terminals and renderer projections. Renderer is a management surface only.

## Session And Goal Truth

- `mission_runs` is the only durable goal truth. A tick is one bounded agent turn.
- `flow_runs(controller_id="goal-wake")` is the wait ledger; its only writer is the SQL CAS writer.
- `task_runs(runtime="process")` is the truth for goal-owned durable process runs.
- Native `exec/process` sessions remain supervisor-owned and non-durable; restart marks them `lost`.
- No universal `session_resources` table, no `SessionDesiredState`, no `SessionReconciler`.

## Admission

- Every side-effect entry point acquires a `SessionAdmissionRegistry` permit before enqueue,
  spawn, steer, arm, or ack.
- Identity is `agentId + canonicalSessionKey + expectedSessionId`; `scopeKey` is not identity.
- `fence(identity)` atomically closes the entry point, waits for in-flight admission critical
  sections, and returns an exclusive token. Boolean fence checks are insufficient.
- Delete/reset fences before abort/drain. Deleted keys keep a tombstone; only explicit create opens
  a new generation. The same `operationId` drives the Electron local mirror gate; RPC `unknown`
  does not release it.

## Cleanup And Drain

- `cleanupSessionBeforeMutation` is the only canonical finalizer.
- Order: fence -> clear queues -> abort parent -> recursive abort children ->
  waitForEmbeddedAgentRunEnd -> drainScope -> other owners -> mutation.
- `drainScope` succeeds only when: fence closed; handles snapshotted by lifecycle identity; cancel
  issued; all owner `wait()` completed; goal task/flow rows terminal; helper claim protocol closed;
  OS containment empty; owner registry has no new records.
- Any timeout or unknown state rejects mutation. Never degrade to agent-wide kill. Never replay
  spawn.

## Delete Operation Journal

- Caller generates and persists `operationId` before first RPC. Manifest includes version,
  operation type, agent/store identity, canonical key, `expectedSessionId`, `deleteTranscript`,
  deterministic archive plan.
- Idempotency is content-sensitive: same id + same digest returns prior result; same id + different
  digest conflicts.
- `cache_entries` deletion and `store_committed` journal commit in one per-agent SQLite immediate
  transaction.
- Retry order: journal by operationId first. `intent` continues; `store_committed` only finalizes;
  `runtime_committed` returns saved receipt; generation mismatch conflicts.
- Runtime failure or unknown outcome: Electron must not sweep session artifacts and must not
  release its mirror gate. Committed-but-incomplete is `partial_committed` and retries by
  operationId. Offline forced delete is an explicit recovery command.

## Goal Wake And Durable Processes

- Wake delivery is at-least-once; effect owners perform durable deduplication. Acceptance asserts
  "duplicate delivery causes no duplicate side effects", never "exactly one tick".
- Mission tick fencing uses `revision + active_tick_id + last_wake_id`; leases only coordinate
  attempts.
- Arm is one SQLite immediate transaction: `task_runs(queued) + flow_runs(waiting) +
  mission(sleeping, activeWaitFlowIds)` before spawn; a committed arm immediately runs a terminal
  level-check.
- Turn barrier: a waiting goal flow must have `turnBarrier="acked"` before dispatch; the run must be
  fully idle before ack.
- Durable run protocol is `intent.json -> started.json -> exit.json`. `intent` without `started`
  and no live helper resolves to `lost`; commands are never auto-restarted.
- Raw command/env/secret text must not persist. `exit.json` is terminal truth; cancel writes
  `control.json` only.
- Session reset/delete invalidates `ownerEpoch`, cancels helpers, finalizes task/flow rows, removes
  runDir. New generations never adopt old waits.
- `WaitFlow` is the only goal waker for `wait="goal"`. System events and heartbeat are accelerators
  only.
- `goal_wait` runs only in mission owner/lead top-level turns; context binds
  mission/session/tick identity. P0 supports one process dependency and fixed mission_tick
  continuation.

## Terminal Lifecycle

- Terminals default `keep_on_leave`. Close only on explicit End, session reset/delete, permission
  tightening, workspace switch/delete, or app quit.
- `idleTtlMs = 0` until a real activity signal exists. Workspace cap is null until capacity
  evidence exists; any future cap is admission rejection, never LRU eviction.
- Global listing reuses `terminal.list({})`; terminal-api must not inject the active workspace when
  omitted.

## Projections And Rollout Locks

- `SessionActivity` is a read model only and may project goal/process/lineage.
- Handoff remains a read-only continuity artifact; it never transfers goals, drains resources, or
  mutates source.
- Fork inherits transcript/workspace/model preferences only.
- `pause` means admission gate + abort current run; `resume` only reopens the gate.
- `continuationTurns` has no new semantics until a real writer and schema exist.
- New behavior is default-off and gated. Ordinary Chat and `background=true` default behavior do
  not change.
- VerseShell rollout locks remain `default-off`, `liveReady=false`, `productApproved=false`.
