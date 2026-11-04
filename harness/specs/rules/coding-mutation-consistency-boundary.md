---
id: coding-mutation-consistency-boundary
title: Coding Mutation Consistency and Recovery Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# Coding Mutation Consistency and Recovery Boundary

## Preflight Requirement

- Native write/edit workspace authorization wraps every pre-image/diagnostic
  read, including the write journal. A refused target must not be copied into
  workspace-readable snapshots. Limited journal reads use the existing rooted
  filesystem boundary after acquiring their path lease.

- `apply_patch` must complete a preflight phase before any filesystem mutation.
- Preflight parses every hunk, resolves every target path, pre-reads every file
  to be updated, and pre-computes every update result. A preflight failure
  returns an error with zero files touched.
- Preflight is always active for `apply_patch`. There is no opt-out to the old
  inline apply loop.

## Batch State Machine

- A multi-file `apply_patch` is a single batch with the state machine
  `prepared -> committed`, `prepared -> rolled_back`, or
  `prepared -> recovery_required`.
- `prepared`: preflight succeeded and original content is captured for every
  target file. No mutation is visible yet.
- `committed`: every hunk has been applied to disk successfully.
- `rolled_back`: a later hunk failed and all previously applied hunks were
  restored to their pre-computed original content. Disk matches the pre-patch
  state.
- `recovery_required`: rollback of a failed batch could not fully restore a
  file. The result includes a `recoveryRef` identifying the retained journal
  entries. The caller must not treat the workspace as clean.

## Lease Ordering

- A per-file batch lease is acquired in path-sorted order during preflight,
  before any mutation. Overlapping concurrent patches are serialized, not
  interleaved.
- The batch lease is independent of `runtime.symbolLease.enabled` and does not
  depend on that flag. It is an internal apply_patch mechanism.
- The lease is released after commit or rollback completes.

## Recovery Contract

- The existing write journal (`write-journal.ts`) remains the single mutation
  evidence authority. UAS-04 adds no second journal.
- When rollback fails, the journal entries for the unrestored files are
  retained and the `recoveryRef` points to them.
- Crash recovery can detect a prepared-but-uncommitted entry after a simulated
  restart because the journal sidecar records the write intent.

## Producer-Boundary Coordination

- The `coding-runtime-workspace-dcs-producer-boundary` rule states that no
  verify outcome may roll back a successful mutation. UAS-04 respects this:
  only failed-batch partial mutations (hunks applied before a later hunk
  failed) are rolled back, because within a failed batch those writes are
  uncommitted partial state, not successful mutations.
- A committed batch is a successful mutation. Post-write verify failure never
  rolls back a committed batch.

## Prohibitions

- Do not leave silent partial mutation on disk after a failed multi-file patch.
- Do not create a second write journal, run journal, or mutation authority.
- Do not migrate the write journal into VerseShell or any non-Coding authority.
- Do not claim cross-filesystem true atomic transactions. Only application-level
  prepare/commit/rollback is in scope.
- Do not change Coding default destructive tier, liveReady, productApproved,
  defaultOn, TF-0006, TF-0009, or TF-0018 ownership.
