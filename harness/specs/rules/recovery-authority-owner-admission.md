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

The default stays legacy. Read-only shadow never mutates an owner. One authority
mode gate controls all five entry points and supports rollback. Frozen product
locks and evaluation thresholds remain unchanged; a clean focused check is not GA.
