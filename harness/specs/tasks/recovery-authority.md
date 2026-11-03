---
lifecycleStatus: active
id: recovery-authority
title: Freeze recovery contract and RecoveryAuthority typed interface
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Freeze the five recovery entry points into one dependency-free RecoveryAuthority contract covering owner, admission, replay class, effect certainty, retry budget, and a single decision surface. This is research plus contract only; no production behavior, default, product lock, database, or service changes.
touchedAreas:
  - harness/specs/tasks/recovery-authority.md
  - docs/dev/recovery-contract/AUTHORITY-MAP.zh-CN.md
  - shared/recovery-authority/contract.ts
  - tests/unit/recovery-authority-contract.test.ts
  - .gitignore
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - No user-visible recovery behavior changes; every existing entry keeps its current legacy path.
  - A future recovery diagnostic can name one owner, one admission boundary, one replay class, one effect certainty, and one finite attempt budget instead of inventing a local retry policy.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-authority-convergence-boundary
  - runtime-lifecycle-governance-boundary
  - docs-sync
requiredTests:
  - tests/unit/recovery-authority-contract.test.ts
acceptance:
  - The authority map covers all five existing entries (main session restart, subagent orphan, goal-wake/durable helper, final delivery, ACP runtime resume) with file and line references.
  - The map separates read-only aggregation sources from changes that require production behavior work, and names the owner for each entry.
  - shared/recovery-authority/contract.ts exports RecoveryAuthorityRequest, RecoveryDecision, RecoveryOwner, AdmissionBoundary, ReplayClass, EffectCertainty, RecoveryBudget, and RecoveryAuthority with no runtime imports.
  - A receipt, event-log record, or transcript cannot be promoted to effect truth; replay requires a domain journal and replayClass=safe.
  - EffectCertainty=unknown always resolves to reconcile, before resume, replay, or deliver.
  - Every admitted recovery request has an owner and a finite, non-zero retry ceiling; malformed input fails closed with kind=reject and basis=invalid-request.
  - One request produces exactly one RecoveryDecision; the RecoveryAuthority interface does not expose a fan-out list.
  - `pnpm exec vitest run tests/unit/recovery-authority-contract.test.ts --maxWorkers=1` passes.
  - `pnpm harness validate --spec harness/specs/tasks/recovery-authority.md` passes.
  - `pnpm run typecheck` passes when the environment can run it.
  - No production path, default switch, product lock, database, service, queue, or protocol is changed.
docs:
  required: false
  note: Internal recovery contract and source map only; no README, UI, or user-facing behavior change.
---

# Recovery Authority Contract

## Objective

Freeze the vocabulary and decision rules for the five recovery entry points before any
wiring work. The contract is a **decision layer**, not a sixth recovery implementation and
not a new state store.

The source map is `docs/dev/recovery-contract/AUTHORITY-MAP.zh-CN.md`. It is the review
artifact for trigger conditions, authority sources, retry/backoff, terminal states, gaps, and
ownership. This document answers the seven contract questions; the TypeScript file is the
machine-readable form.

## The five owners

| Entry | Existing owner | Why it owns the truth |
|---|---|---|
| `main-session-restart` | session store `SessionEntry` | `status`, `abortedLastRun`, and pending final delivery fields are already durable |
| `subagent-orphan` | subagent registry + session store `subagentRecovery` | active run membership and per-session recovery gate are already separate durable/in-memory truths |
| `goal-wake-durable` | SQLite `task_runs`/`flow_runs`/`mission_runs` + helper protocol files | task status and the intent/started/exit file protocol already define process-run truth |
| `final-delivery` | session store `pendingFinalDelivery*` + message durable send context | the pending payload and delivery result are already persisted there |
| `acp-runtime-resume` | `SessionAcpMeta.identity` + runtime handle cache | ACP resume identity and output boundary already live there |

The unified `RecoveryAuthority` must not replace these owners. It receives facts and returns a
decision; the owner adapter performs the owner-specific mutation.

## 1. Who owns recovery?

Every request must name exactly one `RecoveryOwner` with a stable `ownerId` and the relevant
session/run/task/delivery identity. The owner subsystem remains the only truth for its state:

- main session: `SessionEntry.status`, `abortedLastRun`, `pendingFinalDelivery*`;
- subagent: active registry run plus `SessionEntry.subagentRecovery`;
- goal wake: `task_runs` plus helper protocol files; mission/flow fencing is the existing
  committed arm unit;
- final delivery: `pendingFinalDelivery*` plus the durable send intent;
- ACP: `SessionAcpMeta.identity` plus the runtime handle output boundary.

`RecoveryAuthority` owns only the **decision**, not the state. It must never invent an owner,
create a new store, or silently copy another entry's state into the request.

## 2. When is a recovery admitted?

A request is admitted only when all of the following are true:

1. the owner exists and its identity fields are non-empty;
2. the admission trigger matches a real entry condition in the authority map;
3. the required pre-state is observed (`abortedLastRun`, active subagent run, queued/running
   task, pending final delivery, missing persistent session, or repeated repair);
4. no visible output has been observed for a resume/replay request; after output, the request
   may only reconcile;
5. the attempt budget is not exhausted and `wedge.wedged` is false;
6. `idempotencyKey` is stable and non-empty.

Anything else is a fail-closed rejection. A rejection is still one `RecoveryDecision` with
`kind=reject` and an explicit `basis`; invalid shape uses `basis=invalid-request` and may have
`owner=null`. The entry point must not turn a rejection into a local retry loop.

## 3. Which states must commit together?

The minimum recovery commit unit is:

- the owner's safety/state transition (for example clear `abortedLastRun`, write a task
  terminal status, or mark pending delivery as terminal);
- the consumed attempt count and wedge state;
- the recovery decision identity and idempotency key.

Where the owner already has a transaction, use it. Goal-wake already models this with
`task_runs(queued) + flow_runs(waiting) + mission_runs(sleeping/activeWaitFlowIds)` in one
SQLite immediate transaction. Main/subagent/delivery/ACP must use their existing session or
send-intent transaction when wired; if no transaction exists, write a durable decision intent
first and reconcile it before mutating the owner state. **Never clear a safety marker before
the decision and budget are durably committed.**

## 4. Can it rerun after an interruption?

Only by `ReplayClass`:

- `safe`: replay is idempotent/read-only. Retry with the same `idempotencyKey` returns the same
  decision or the same settled outcome; it must not create a new side effect.
- `unsafe`: do not replay blindly. If the effect is unknown, reconcile; if the effect is
  applied/reconciled, settle; otherwise the owner must supply a different safe path.
- `reconcile`: inspect the domain journal and effect-receipt correlation before deciding.

Interruption before the commit: re-evaluate the same request; no duplicate side effect because
the idempotency key is stable. Interruption after the commit: return the saved decision. A
new random UUID per attempt is explicitly outside this contract.

## 5. What happens when the effect is uncertain?

`EffectCertainty=unknown` always resolves to `reconcile`. It must not fall through to `resume`,
`replay`, or `deliver`. Reconciliation reads the domain journal first; effect receipts may
correlate and explain, but they cannot become effect truth. `EffectCertainty=applied` or
`reconciled` resolves to `settle` and forbids replay. Only `EffectCertainty=not_applied` may
proceed to a fresh resume or, when `ReplayClass=safe` and domain-journal truth exists, to
`replay`.

## 6. Who decides recovery?

`RecoveryAuthority` decides exactly one `RecoveryDecision` per request. Entry adapters only
supply observed facts:

- they must not each implement their own retry ceiling or replay policy;
- they must not fan one request out to multiple independent decisions;
- they must not treat event-log or receipt evidence as authorization.

Until an entry is wired, the existing legacy code decides. That is the default. The contract
does not change authority merely by existing.

## 7. What happens after repeated recovery failure?

`RecoveryBudget` is mandatory and finite:

- `attempts.current` counts all attempts, including failed attempts;
- `attempts.max` is a finite integer >= 1;
- `backoff.initialMs`, `backoff.multiplier`, and optional `backoff.maxMs` define the schedule;
- `wedge.afterAttempts` is a finite threshold within `attempts.max`;
- `wedge.wedged=true` is a durable tombstone.

When the budget is exhausted or wedged, the decision is `wedge` with `basis=budget`; automatic
recovery stops. Existing owner tombstones map to this state: subagent `wedgedAt`, goal-wake
`task_runs.status=lost`, delivery terminal/pending state, main session terminal failure. Clearing
a wedge requires an explicit owner maintenance/doctor/operator transition, not a new scheduler
retry.

## Default legacy, rollback single switch, event-log evidence only

- **Default legacy**: all five entry paths keep their current behavior. The contract is not
  wired into production in this task. No goal-wake, durable-helper, delivery, ACP, main-session,
  subagent, or rollback default changes.
- **Rollback single switch**: the only rollback switch is `runtime.mission.rollback.enabled`,
  default false. `RecoveryAuthority` must not introduce a second per-entry rollback switch.
- **Event-log evidence only**: Runtime event-log flags remain false by default; the event log
  is diagnostic/evidence. It cannot be used as recovery authority, effect truth, or replay
  authorization. The `event_log` replay target remains unimplemented and legacy checkpoint is
  the only production rollback path.

## Validation and evidence

- `pnpm exec vitest run tests/unit/recovery-authority-contract.test.ts --maxWorkers=1`
- `pnpm harness validate --spec harness/specs/tasks/recovery-authority.md`
- `pnpm run typecheck` when the environment can run it.

The unit test is the executable form of the invariants: receipt/event-log/transcript cannot
authorize replay; unknown effect reconciles; every admitted request has an owner and a finite
retry ceiling; one entry returns one decision; malformed input fails closed.

## Non-goals

- No production wiring, default flip, product-lock change, new database, new service, new
  queue, new protocol, or new scheduler.
- No claim of crash/restart recovery success or long-conversation stability evidence in this
  node.
- No claim of real-human evidence; all artifacts are `driven_by: agent` and
  `actor: recovery-authority-agent`.


