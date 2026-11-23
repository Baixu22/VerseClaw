---
id: checkout-writer-ownership
title: Managed checkout writer reservations and maintenance fencing
type: guide
appliesTo:
  - checkout-writer-ownership
---

**WorktreeService owns durable exclusive checkout writers. Its merge, candidate-freeze and cleanup paths use the same reservations before filesystem effects.** A lifecycle owner identifies who created and retains a worktree. A writer identifies an execution scope using its scoped run, physical session generation and captured binding revision. These are separate records; creation ownership does not authorize a tool write.

The existing shared Runtime SQLite `state_leases` table stores the WorktreeService namespace. The original per-root worktree mutex serializes registration and maintenance with writer mutations; short SQLite transactions serialize competing runtime processes. No process-local Map can grant ownership. A canonical native root is the exclusion key, so aliases share one reservation and separate checkouts can proceed concurrently. Installations with different state directories do not share this local authority.

The desktop launch owner supplies `CLAWX_EXECUTION_STATE_PATH` to its Gateway. Execution-domain registrations, worktree registration, checkout writers and managed-process reservations use that same existing SQLite file. A source Gateway can keep its isolated session/config state without creating a second execution resource owner. Standalone runtimes retain their normal state path when this internal launch binding is absent.

Writer credentials contain root, filesystem incarnation, worktree generation, monotonically increasing writer epoch, owner and an opaque token. An identical current claim request returns its credential; changed request content or a retired request cannot mint a new writer. Released records preserve the epoch and retired request identities across cleanup/recreation. Optional expiry rejects new operations but never releases ownership or proves the old process stopped.

Each writer operation records a stable operation ID and request digest before execution. A known completion or not-applied owner receipt settles it; a replay returns that receipt and does not authorize another effect. Conflicting digests or receipts reject. In-flight and unknown operations prevent release. Drain closes admission, allows the original owner to settle existing operations, and permits release only after every operation is settled. The API consumes trusted owner receipts; it does not infer external tool outcomes from model text, elapsed time or a bare PID.

Maintenance claims every affected root before the first effect: merge claims base and worker, freeze claims base and all candidate inputs, cleanup claims the disposable checkout. Failure to acquire any root releases only unused claims. Metadata preparation runs before filesystem effects; its failure returns unused reservations. Once an effect starts, failure retains an unknown operation. Cleanup can finish its own interrupted receipt when its original generation and persisted cleanup intent match an absent path; it cannot settle a different writer or adopt replacement content.

If a process exits between metadata preparation and effect admission, a maintenance claim with no operations can be retired only after its recorded process incarnation has ended. This recovery never applies to run writers or admitted effects. The same native worktree mutex and the SQLite transaction still serialize the retry.

The writer state and its snapshots are resource-owner facts. TaskSystemStore, current session admission, Main binding and permission retain their own checks. The managed tool boundary now composes these owners through `executeManagedTaskTool` for both raw and hook-wrapped tools. Known read operations retain their original path; governed file/process effects acquire the selected checkout writer and record their task and resource operations before execution. External editors and commands outside this boundary remain outside enforcement. The existing in-process file/subtree locks continue their local serialization.

Automatic file verification runs after the mutation's Task and checkout receipts settle, while the originating run retains its writer. It uses the final policy-wrapped exec tool. Canonical edit parameter, path and file-operation owners can record a not-applied rejection only before delegating execution or dispatching `writeFile`; the private error identity and tool call ID bind that receipt. The boundary reconciles both ledgers from that owner fact. After write dispatch, recovery requires an exact full-byte comparison with the expected encoded file; missing untouched bytes or unavailable readback retain unknown. Dispatched failures use a fresh Error identity while retaining their diagnostic properties, so a reused Error and call ID cannot replay an earlier rejection. Model-supplied outcome fields do not create receipts.

The resource slice's original evidence remains under `checkout-writer-ownership`. Joint task, Mission and clone routing is evaluated separately under `unified-effect-admission` and retains its complete acceptance criteria.

Ordinary selected roots and registered managed worktrees use the same native-root exclusion key. A managed root resolves through its existing registration and generation; incomplete or replaced registrations reject rather than becoming independent roots. Writer ownership persists between tool calls. A terminal run receipt closes admission, while unresolved operations and processes retain ownership until their original owners reconcile them.

Canonical task delegation can transfer a drained checkout directly to its child in one SQLite writer transaction. The transaction changes epoch/token without exposing a released gap. The composition verifies the recorded parent/child TaskCredential and exact dispatch operation; a parent spawn call may remain active while its child writes. Coordinator pause retains the captured execution binding for an already admitted run, while a different task/environment/generation requires fresh admission.

The current owner row retains request identities and current-lease receipts as one SQLite aggregate. Cost grows with the lifetime number of claims on that root. If measurements warrant it, move those identities to indexed child rows while preserving the request/epoch contract; never evict retired identities in a way that can reauthorize an old request.

Validation uses real temporary Git directories, independent Node processes and SQLite reopen; cases cover same-root contention, separate roots, alias normalization, crash, expiry, clock rollback, old credentials, request/receipt conflicts, path replacement, failed multi-root preflight and interrupted cleanup. Negative tests invoke the actual merge/freeze/cleanup owner paths and read files back after refusal.
