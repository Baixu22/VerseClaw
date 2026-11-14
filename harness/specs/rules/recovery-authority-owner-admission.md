---
id: recovery-authority-owner-admission
title: Durable owner admission precedes automatic recovery
type: ai-coding-rule
severity: error
appliesTo:
  - recovery-authority-gated
---

An automatic recovery is a new admission across a failure boundary. The existing
owner must atomically preserve its identity, the decision, the boundary key, and
the consumed attempt before dispatch. A failed attempt counts too. An unacknowledged
admission is uncertain; it cannot be reclassified as an unstarted effect merely
because the client saw an error or no visible output.

ACP records its current request, runtime identity, output boundary and consumed
attempts in the existing acp_sessions row. The original two-attempt-per-backend
plan supplies one persisted ceiling for that request; recreating a controller or
changing a fallback plan cannot reset it. Runtime entry records unknown before
calling either turn API. Output is journaled before publication. Only Core-proven
pre-turn failures retain not_applied truth and can admit a fresh handle or backend.
Fresh-handle and failover paths share the same admission. Identity acknowledgements
check the Session generation and exact journal again; applied requests settle and
unknown outcomes remain pending after mode rollback. A committed owner write with
a lost acknowledgement retains its consumed attempt and releases only that claim.

All gated entry points call the same RecoveryAuthority. Existing journals and
durable queues supply effect truth. Unknown outcomes reconcile; already applied
or reconciled effects settle without replay or another delivery. Receipts,
transcripts, and diagnostic events provide evidence only.

Acknowledgement and terminal updates check the owner generation and admitted
boundary again. An old callback cannot clear a newer abort marker, replace a
newer pending payload, or reset a newer ACP identity. Recovery state stays in the
existing owner store; there is no parallel ledger or executor.

An admitted subagent continuation writes the original session lifecycle while
its synthetic prompt remains suppressed. An unknown RPC acknowledgement retains
the admission: that exact run may consume its previously authorized tool call.
A reconciliation decision that never admitted the run cannot execute the call.

Run-level admission hooks and the initialized tool lifecycle precede recovered
tool execution. A blocked hook cannot leave an already executed recovery effect.
Recovered tool events use the current session subscriber, preserving delivery
bookkeeping, tool completion, and browser activity under the original call ID.

Main-session output crosses a Session-owned write-ahead boundary. Persisted text
does not establish a not_applied effect. A main recovery acknowledgement must
match its admitted run and cannot clear a later interruption or another payload.
Unknown owner outcomes retain their registry row through terminal callbacks and
cold-start pruning. Usage history is not a generation transfer: ordinary session
rotations clear prior recovery ownership; compaction explicitly preserves it.

Final delivery binds the exact pending Session reply to the existing queue intent
before platform send. The queue commits its decision and consumed attempt together,
then clears or confirms replacement of that Session reference before deleting a
confirmed applied intent. An altered reply still referencing the same intent
retains its applied queue truth until that reference is settled or replaced.
Reply replacement clears the old intent reference; settlement checks the Session,
producer, text, creation time, route and intent again. Unknown and partial sends
remain pending after rollback or budget exhaustion. A not-sent reconciliation
preserves the owner's existing backoff before consuming another dispatch attempt.
Reconciliation commits its current PID/epoch and holds the original queue claim
until the observation finishes, then releases it without consuming a send attempt.
Authority sends cannot downgrade an initial queue or ownership write failure to
best-effort delivery; the platform send must stop before effects.

Startup queue metadata backfill must compare its original serialized snapshot
before updating indexed fields. A concurrent admission cannot lose its consumed
budget to an older snapshot. Process evidence reads raw SQLite columns without
schema repair and checks published peer claims against the same durable budget.
Confirmed complete sends commit callbacks after durable applied truth, before
Session reference cleanup; uncertain or partial sends do not run those callbacks.
Every platform send rechecks the exact Session reply binding. The permit uses the
persisted outbound agent identity for global Session keys and remains held through
live recovery callbacks and Session settlement. A retired reply reconciles its
original queue truth without a new lifecycle notification; confirmed applied truth
can settle through a reset/delete fence. A notification admitted for a live reply
confirms the original queue payload and receipt even if pending text later changes;
Session reference settlement retains its identity/CAS check. A changed reply still referencing that
intent retains its applied truth. Core-proven failures
before platform entry retain not_applied truth and the already-consumed attempt;
an error or absent output alone never clears an unknown outcome.
Commit hooks are process-local best-effort notifications; applied restart recovery
settles its intent without replaying them.

The default stays legacy. Read-only shadow never mutates an owner. One authority
mode gate controls all five entry points and supports rollback. Frozen product
locks and evaluation thresholds remain unchanged; a clean focused check is not GA.
