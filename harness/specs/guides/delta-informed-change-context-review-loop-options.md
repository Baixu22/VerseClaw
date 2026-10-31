---
id: delta-informed-change-context-review-loop-options
title: Delta-informed Change Context and Review Loop Decision
type: guide
status: accepted-for-contract
decision_date: 2026-10-30
research_route: versesearch(anysearch-then-exa)
selected_option: B
---

# Delta-informed Change Context and Review Loop Decision

## 1. Question

What should ClawX absorb from Delta's most valuable workflow without creating a second version-control, task, execution, approval or collaboration authority?

The useful Delta product grammar is:

- The conversation and the code changes are reviewed together.
- The user can compare the current work with an explicit recent baseline.
- Feedback can be anchored to a file or code range.
- Review produces a visible verdict and a controlled next action.
- The durable work object is separate from a disposable checkout.

ClawX already has Session, Workspace, Task Ledger, Code Review, Git/Worktree, write journal and VG evidence. The question is therefore an integration and authority question, not a request to copy DeltaDB.

## 2. Route and sources

VerseSearch routing used AnySearch for discovery and Exa for official-document extraction and semantic retrieval.

AnySearch discovery surfaced:

- The diff is late to the conversation: https://neodrop.ai/post/ioxC9uyd3vV
- Replacing Pull Requests with Delta discussion: https://lobste.rs/c/hw3e7x
- Editor comparison of agent review and comment placement: https://dev.to/urion/every-editor-now-reviews-your-agents-code-where-do-your-comments-go-34fc

Exa official-source retrieval used:

- https://delta.dev/docs/agents/review-and-sync
- https://delta.dev/docs/agents/comments
- https://delta.dev/docs/concepts/delta-and-git
- https://delta.dev/docs/concepts/worktrees
- https://delta.dev/docs/collaboration/collaborate-thread
- https://delta.dev/docs/cli/build-a-plugin

Local source baseline:

- D:/ClawX/docs/modules/workspace-and-coding.md
- D:/ClawX/docs/modules/sessions.md
- D:/ClawX/docs/modules/verse-tools.md
- D:/ClawX/shared/types/code-review.ts
- D:/ClawX/shared/types/workspace.ts
- D:/ClawX/shared/types/versegit.ts
- D:/ClawX/shared/versegit-runtime-contract.ts
- D:/ClawX/electron/services/code-review-api.ts
- D:/ClawX/electron/services/git-api.ts
- D:/ClawX/electron/services/versegit-observation.ts
- D:/ClawX/electron/services/versegit-receipt-bridge.ts
- D:/ClawX/src/components/file-preview/WorkspaceReviewPanel.tsx
- D:/ClawX/src/components/file-preview/WorkspaceGitPanel.tsx
- D:/ClawX/src/pages/CodeReview/index.tsx

No proprietary repository content was sent to AnySearch or Exa. Provider outputs were used only for product and architecture comparison.

## 3. Candidate options

### Option A: DeltaDB-compatible CRDT and real-time multiplayer

Description:

- Introduce a replicated CRDT store containing conversation, comments and file-tree history.
- Make the replicated worktree, not Git, the primary active work representation.
- Synchronize collaborators and temporary checkouts.

Rejected because:

- It duplicates Git/worktree authority that VG deliberately preserves.
- It requires a new sync server, conflict model, storage lifecycle and privacy boundary.
- It conflicts with the current controlled-preview, local-first and fail-closed product posture.
- It is far larger than the user-visible benefit proven by source review.

### Option B: Read-only Change Context plus anchored Review Loop over existing owners

Description:

- Add a read-only Change Context projection over Session, Workspace, Git, Code Review, write journal, Observability, Task Ledger and VG facts.
- Add explicit comparison modes: merge base, last commit, last turn and checkpoint.
- Add durable review comments anchored by path, range, content digest and candidate/revision identity.
- Add review verdicts that create or link existing Task Ledger nodes.
- Make Pull Changes an explicit, approval-governed operation through the existing Git/apply path.
- Keep VG evidence advisory and read-only.

Selected because:

- It captures the strongest Delta workflow while retaining current authority boundaries.
- It can be delivered in stages with focused tests and no new execution engine.
- It turns already-existing evidence into a coherent user workflow.
- It gives a measurable path to decide later whether deeper versioning is justified.

### Option C: UI-only summary with no durable anchors

Rejected because:

- Comments cannot survive edits.
- Review feedback cannot be reliably linked back to code or Task Ledger.
- The result would look like Delta but fail the core provenance promise.

### Option D: External-agent protocol only

Rejected as the first slice because:

- It improves integration reliability but does not deliver the user-visible context and review gap.
- The outbox/fencing protocol remains a later compatible extension, not a substitute for Change Context.

## 4. Selected design

### 4.1 Change Context is a projection, not an owner

The projection must reference existing facts rather than copy their lifecycle state.

Minimum identity:

- workspaceId
- sessionKey
- optional runId
- base kind and immutable base OID/ref
- optional turn identity and transcript sequence bounds
- candidateId when VG evidence is present
- evidence references with source owner and freshness

The projection may cache derived read models but never becomes the authority for session, task, execution, approval, Git status or VG verdict facts.

### 4.2 Comparison modes

The first release supports:

- merge base against the selected upstream ref
- last commit
- last turn
- selected checkpoint

Unknown, unavailable and truncated comparisons must stay explicit and must not render as an empty diff.

### 4.3 Anchored review comments

A comment anchor contains:

- path
- range start and end
- file digest
- range digest
- base revision or candidate identity
- original excerpt
- creating session/run and actor
- resolution state

Anchor state is one of:

- live: current digest matches
- stale: path still exists but the anchored content changed
- removed: the anchored content no longer exists in the selected revision
- unavailable: the evidence needed to prove freshness is missing

The UI must never silently move a comment to a different range when the digest changes. A stale or removed anchor remains visible and can be re-anchored explicitly.

### 4.4 Review verdict and next action

Supported verdicts:

- approve
- request changes
- comment only

A verdict is evidence and workflow state. It does not complete a Task Ledger node and does not merge or apply code by itself.

Request changes may create or link one existing Task Ledger node. Pull Changes is enabled only when:

- the reviewed patch still applies to the selected destination
- the patch is digest-bound
- required approval is present
- the apply path remains the existing Git/write-journal authority
- stale or conflicted application is rejected rather than force-applied

### 4.5 VG evidence

VG stale-read findings, candidate identity and VerseShell receipt facts may be shown as read-only evidence cards.

Rules:

- no VG call in the default or single-session path unless the existing opt-in gate is satisfied
- missing receipt remains unmeasured or partial
- stale-read warning remains advisory
- host verdict remains unchanged
- no land/admit action is exposed
- no M4 authority is introduced

## 5. Authority and scope boundaries

In scope:

- user-visible Change Context
- explicit comparison modes
- durable anchored comments
- review verdict and Task Ledger linkage
- controlled Pull Changes through existing mutation authority
- read-only VG evidence projection

Out of scope:

- DeltaDB or CRDT
- real-time multi-user collaboration
- cloud upload or synchronization
- cloud runners
- mandatory login or telemetry
- automatic agent execution
- new approval, write journal, task graph or execution authority
- default-on VG
- M4 landing authority
- product-lock, release or default-value changes

## 6. Development standard

- Start from harness/specs/tasks/change-context-review-loop.md and run pnpm harness context before implementation.
- Extend shared/host-api/contract.ts before exposing renderer behavior.
- Renderer calls only src/lib/host-api.ts or src/lib/host-api-client.ts.
- User-facing strings require en, zh, ja and ru locale entries.
- Every state transition must have a negative test.
- A missing or stale source must remain unavailable, stale or unknown; it must not become an empty success.
- Review comments may be persisted locally, but the store must be explicitly owned, bounded, deletable and excluded from Task Ledger and execution authority.
- Pull Changes may call only the existing Git/apply and approval boundaries.
- VG integration must remain behind its existing opt-in gate and advisory boundary.
- Temporary output goes to D:/tmp or an ignored repository directory.

## 7. Test and acceptance flow

### Gate 1: contract

- shared types and Host API contract exist
- contract implementation and renderer facade stay aligned
- pnpm contract:check exits zero

### Gate 2: focused logic

- comparison selection
- turn bounds
- digest anchoring
- stale/removed/unavailable states
- verdict transitions
- Task Ledger linkage
- denied Pull Changes

### Gate 3: UI integration

- four locales
- loading, empty, unavailable, partial and error states
- keyboard/focus behavior
- no direct IPC
- no silent comment movement

### Gate 4: Electron E2E

- open a real session/workspace fixture
- select each comparison mode
- create and refresh a comment anchor
- change the underlying file and prove stale state
- create a Task Ledger node from request changes
- prove approve does not complete the task
- prove stale or conflicted Pull Changes fails closed
- capture deterministic final state

### Gate 5: acceptance evidence

- candidate commit/tree
- commands and exit codes
- parsed counts
- screenshots or UI evidence for the tested state
- artifact SHA256 manifest
- explicit not-run and residual list
- Task Forest validate and export

No node may close from stdout alone. Evidence must be re-read from disk and bound to the same candidate.

## 8. Decision

Adopt Option B.

The first implementation slice is deliberately local and API-driven. It should make ClawX's existing facts legible as one work object before any decision about real-time collaboration or a new version store.
