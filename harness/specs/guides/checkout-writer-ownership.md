---
id: checkout-writer-ownership
title: Managed checkout writer reservations and maintenance fencing
type: guide
appliesTo:
  - checkout-writer-ownership
---

**WorktreeService owns durable exclusive checkout writers. Its merge, candidate-freeze and cleanup paths use the same reservations before filesystem effects.** A lifecycle owner identifies who created and retains a worktree. A writer identifies an execution scope using its scoped run, physical session generation and captured binding revision. These are separate records; creation ownership does not authorize a tool write.

The existing shared Runtime SQLite `state_leases` table stores the WorktreeService namespace. The original per-root worktree mutex serializes registration and maintenance with writer mutations; short SQLite transactions serialize competing runtime processes. No process-local Map can grant ownership. A canonical native root is the exclusion key, so aliases share one reservation and separate checkouts can proceed concurrently. Installations with different state directories do not share this local authority.

Writer credentials contain root, filesystem incarnation, worktree generation, monotonically increasing writer epoch, owner and an opaque token. An identical current claim request returns its credential; changed request content or a retired request cannot mint a new writer. Released records preserve the epoch and retired request identities across cleanup/recreation. Optional expiry rejects new operations but never releases ownership or proves the old process stopped.

Each writer operation records a stable operation ID and request digest before execution. A known completion or not-applied owner receipt settles it; a replay returns that receipt and does not authorize another effect. Conflicting digests or receipts reject. In-flight and unknown operations prevent release. Drain closes admission, allows the original owner to settle existing operations, and permits release only after every operation is settled. The API consumes trusted owner receipts; it does not infer external tool outcomes from model text, elapsed time or a bare PID.

Maintenance claims every affected root before the first effect: merge claims base and worker, freeze claims base and all candidate inputs, cleanup claims the disposable checkout. Failure to acquire any root releases only unused claims. Metadata preparation runs before filesystem effects; its failure returns unused reservations. Once an effect starts, failure retains an unknown operation. Cleanup can finish its own interrupted receipt when its original generation and persisted cleanup intent match an absent path; it cannot settle a different writer or adopt replacement content.

If a process exits between metadata preparation and effect admission, a maintenance claim with no operations can be retired only after its recorded process incarnation has ended. This recovery never applies to run writers or admitted effects. The same native worktree mutex and the SQLite transaction still serialize the retry.

The writer state and its snapshots are resource-owner facts. They do not establish a TaskSystemStore claim, current session admission, current Main binding revision or permission. The parent joint-admission task still owns that composition and the real tool-entry integration. Until that integration is validated, ordinary tool calls and external editors are not claimed to be fenced by this new resource API. The existing in-process file/subtree locks continue to provide their current local serialization.

This is an independently validated child of the joint-admission work. It avoids the active session/task-domain implementation's files and preserves the parent's complete acceptance criteria. Existing merge/freeze/cleanup consumers are wired in this slice; Task/Mission/clone execution routing remains part of the parent.

The current owner row retains request identities and current-lease receipts as one SQLite aggregate. Cost grows with the lifetime number of claims on that root. If measurements warrant it, move those identities to indexed child rows while preserving the request/epoch contract; never evict retired identities in a way that can reauthorize an old request.

Validation uses real temporary Git directories, independent Node processes and SQLite reopen; cases cover same-root contention, separate roots, alias normalization, crash, expiry, clock rollback, old credentials, request/receipt conflicts, path replacement, failed multi-root preflight and interrupted cleanup. Negative tests invoke the actual merge/freeze/cleanup owner paths and read files back after refusal.
