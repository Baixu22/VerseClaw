---
id: resource-execution-lifecycle
title: Keep resource slots aligned with execution lifetime
type: ai-coding-rule
severity: error
---

An execution timeout may finish the caller's wait, but capacity stays reserved until
the actual task settles. Carry terminal ownership through nested session/global
queues; timeout propagation must not release an outer lane while inner work remains.
Recovery resets also retain active slots until execution settles; clearing a run
registry or requesting abort does not prove terminal execution.

Bound waiting at the actual agent entry, share its waiting deadline across both
queues, and forward its cancellation signal. Waiting limits exclude active work.
Remove timeout and abort registrations on dequeue, cancellation, expiration and
clear. Reject overload before adding a waiter.

Use the existing SQLite managed-process owner for Main and Gateway host capacity.
Changing pressure limits never clears native or unknown reservations. A native
close/terminal receipt releases the physical process slot. Keep transient pressure
limits separate from the normal limit stored with a process reservation.
Keep a measured observer birth identity across temporarily missing snapshots.
Logical lease cleanup must complete if an advisory host-limit read fails; native
admission still fails closed on an unavailable authoritative capacity database.

The efficiency setting controls diagnostic recording. Minimum memory, commit,
event-loop and power/visibility protection continues until application shutdown.
Bounded reclamation remains eligible while ordinary background work is deferred.
