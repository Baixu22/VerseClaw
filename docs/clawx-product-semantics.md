# ClawX Product Semantics

Last updated: 2026-11-01

Evidence boundary: this document is a product-semantics guardrail that complements `shared/capability-claims.ts` and `artifacts/capability-claims/status-table.json`.

## Positioning

ClawX is an agent workbench, not an automatic project manager. Ordinary Chat is for immediate collaboration. Durable task facts belong to Task Ledger. High-constraint execution belongs to explicit Task Loop runs. Runtime/plugin scheduling belongs to Workboard. Routing Memo is an internal diagnostic; it cannot affect routing until same-session scorecard-backed quality input is available.

## Typed product relations

`PRODUCT_SEMANTIC_RELATIONS` in `shared/product-semantics.ts` records a small set of directed, evidence-linked relationships among the existing product concepts. Each edge names the owning authority boundary; it is not permission, an inverse relation, or a transitively inferred fact. Scope is deliberately narrow: this is not a universal enterprise ontology, a graph database, an inference engine, a runtime path, or prompt injection.

Contract version: `PRODUCT_SEMANTIC_CONTRACT_VERSION = 'ProductSemanticRelations/v1'` in `shared/product-semantics.ts`. A relation is identified by the key derived from its own triple, `relationKey(relation)` = `${from}--${kind}--${to}`; there is no relation ID service. Candidate relations are judged by the pure functions `validateProductSemanticRelation` / `validateProductSemanticRelations` against the closed set `PRODUCT_SEMANTIC_RELATION_RULES` (11 rules). The evidence checker `node scripts/check-evidence-refs.mjs --report <path>` / `--verify <path>` adds 8 closed source rules (`source-missing`, `source-outside-root`, `source-untracked`, `source-symlink-escape`, `source-digest-mismatch`, `candidate-mismatch`, `version-unsupported`, `report-field-missing`) that bind every `evidenceRefs` entry to its canonical and raw SHA-256 digest and bind the report to the candidate commit/tree, so a changed source, a moved candidate or an unsupported version invalidates the report. These checks are metadata-only: no runtime path, prompt, tool, approval, storage or UI reads them, and passing them grants nothing — the owners in the third column keep the real authority. They are consumed by `pnpm test` through `tests/unit/product-semantics.test.ts` and `tests/unit/evidence-refs-exist.test.ts`, which spawns the checker as a real gate entry. Every row below is additionally rejected by the shape rules that apply to any candidate: `unknown-endpoint`, `unknown-kind`, `unknown-authority-boundary`, `self-loop`, `duplicate-relation`, `missing-evidence`, `forged-grant-field` (any key outside `from / kind / to / authorityBoundary / evidenceRefs`, such as `grants`, `permission`, `inverse`, `transitive` or `bidirectional`) and `unsupported-contract-version`.

| Relation (`relationKey` → authority boundary) | Definition | Guarded rule (enforcing owner) | Why it exists | Rejected by |
| --- | --- | --- | --- | --- |
| `chat--suggests-upgrade-to--task-loop` → `advisory-only` | Ordinary Chat may surface a Task Loop upgrade suggestion; it cannot create a Task Ledger root or start a run on its own. | `createTaskLoopUpgradeSuggestion` in `shared/product-semantics.ts` fixes `requiresUserConfirmation: true`, `createsTaskLedgerRoot: true` and `startsRun: 'after-user-confirmation'`; the Chat detector in `src/pages/Chat/task-loop-upgrade.ts` can only emit that shape. | Chat stays immediate and advisory; high-constraint execution remains an explicit Task Loop decision. | `kind-boundary-mismatch` when `suggests-upgrade-to` is paired with any boundary other than `advisory-only`; `self-loop` when the edge collapses to `chat → chat` (the gate negative `bad-relation-self-loop`). |
| `chat--projects--task-ledger` → `read-only-projection` | A Chat session's orchestrator plan is projected into Task Ledger as nodes stamped `readonlyProjection: true`, `source: 'orchestrator.plan'`; the projection never writes task facts. | `buildProjectionMetadata` / `isReadOnlyTaskLedgerProjection` in `src/lib/task-ledger-plan-projection.ts`. | A conversation can show task structure without becoming a second task store. | `kind-boundary-mismatch` when `projects` is paired with any boundary other than `read-only-projection`; `duplicate-relation` when the same key is declared twice; `reverse-task-authority` when the edge is turned around to `from: 'task-ledger'`. |
| `chat-plan--projects--task-ledger` → `read-only-projection` | Chat Plan reads the same projection and may hold lightweight edit drafts (`projectionEdit` metadata written by `src/lib/orchestration-plan-edit-draft.ts`), never Task Ledger facts. | Same owner as the row above; the shared owner is deliberate — no second code path distinguishes a Chat Plan initiator from an ordinary Chat initiator. | Plan view is a projection with drafts, not a DAG editor or a ledger writer. | Same as the row above. |
| `task-loop--roots-in--task-ledger` → `task-ledger-authority` | A Task Loop run resolves or creates its Task Ledger root before any record exists and refuses to start or checkpoint without one. | `startTaskLoop → ensureTaskLedgerRoot` and `recordTaskLoopCheckpoint` in `openclaw_runtime/src/agents/task-loop-controller.ts`. | Task facts stay owned by Task Ledger and loop run state by Task Loop; run success, turn completion and task completion are not derived from each other. | `reverse-task-authority` when `task-ledger-authority` points anywhere but `task-ledger`, or when `from` is `task-ledger`; `kind-boundary-mismatch` when `roots-in` is paired with another boundary. |
| `workboard--references-one-way--task-ledger` → `one-way-reference` | Workboard, runtime and plugin scheduling state may carry a `TaskLedgerReference` whose only direction is `workboard-to-task-ledger`; status, completion and ledger-owned fields never inherit back. | `createTaskLedgerReference` / `isTaskLedgerReference` / `TASK_LEDGER_REFERENCE_INHERITANCE` in `shared/types/task-ledger-reference.ts`. | Prevents a mirror or two-way sync that would make Workboard a scheduling authority over tasks. | `kind-boundary-mismatch` when `references-one-way` is paired with any boundary other than `one-way-reference`, including a raise to `task-ledger-authority` (negative fixture `kind-boundary-mismatch-references-one-way-task-ledger-authority`); `reverse-task-authority` only when the relation is reversed so that `task-ledger` becomes the `from` side, or `task-ledger-authority` is claimed toward a target other than `task-ledger`; `forged-grant-field` for `inverse`, `bidirectional` or `sync` keys. |
| `routing-memo--quality-gated-by--task-loop` → `same-session-scorecard` | Routing Memo authority becomes `active` only on a same-session, verified, scorecard-backed Task Loop quality receipt; anything else stays `shadow` with reason `missing-scorecard-quality`. | `resolveRoutingMemoAuthority` in `openclaw_runtime/src/agents/routing-memo.ts`. | Routing diagnostics cannot promote themselves to routing authority on self-reported or cross-session quality. | `cross-session-quality` when validated with `sessionScope: 'cross-session'`; `kind-boundary-mismatch` when `quality-gated-by` is paired with another boundary. A documented same-session claim without a server-resolved receipt stays documented-only at runtime. |

Provenance for every row — document basis, enforcing owner with line anchors, consumers and regression entries, all bound to the candidate they were read on — is recorded in `harness/specs/fixtures/ontology-lite-existing-contracts/provenance/relations.json`. The negative fixtures that exercise each rejection live under `harness/specs/fixtures/ontology-lite-existing-contracts/negatives/` (rule level) and `harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures/` (through the checker's real entry); the curated final evidence of the hardening is under `harness/specs/fixtures/ontology-lite-existing-contracts/final/`.

## Identity and scope vocabulary

Workspace is not an alias for Project. A Workspace identifies a local executable
root, its agent binding and permission context; a Project is the user-visible,
long-lived container for work. Project is not Task Ledger. Run is not Task.
**Task Ledger remains the only source of user-visible task facts.** Project
aggregation and execution attempts reference those facts without owning a second
copy of their state.

| Identity | Owner | Scope | Lifecycle | Allowed references | Prohibited use |
| --- | --- | --- | --- | --- | --- |
| `WorkspaceId` | Main workspace registry and the existing workspace/permission owner | One registered local execution root with its agent binding and permission context | Survives conversations and runs; ends when the workspace registration is removed, not when a run ends | Explicit Project compatibility association, scoped sessions/runs, permission decisions | Using a conversation key, raw unverified directory, browser session or resource token as a missing workspace fallback; treating the ID itself as permission |
| `ProjectId` | Product work-container owner; currently a compatibility projection, with no new Project store in this slice | Long-term user-visible work container, independent of the execution root abstraction | Outlives individual sessions and attempts; this slice only projects an existing workspace lifetime and does not implement Project lifecycle | Explicit Workspace association and references to existing Task Ledger facts/sessions/runs | Interchanging Project and Workspace fields; duplicating Task Ledger; claiming independent Project CRUD is delivered |
| `SessionKey` | Existing conversation/session owner in Gateway/runtime | One logical conversation within its explicit owner/workspace context | Many turns and runs can share it; transcript reset/rotation may change physical session IDs without establishing a new execution lineage | Conversation history and an optional link in an explicitly scoped run | Workspace fallback, parent-run inference, task completion authority |
| `RunId` | Existing execution owner (ordinary agent turn, Task Loop, ClawGraph or other declared runner) | One execution attempt under an explicit `RunScope`; never assume global uniqueness | Created for an attempt; retry/continuation relationships and terminal state come from the execution owner | Scoped execution, trace/evidence and explicit Task Ledger links | Persisting or transporting a standalone unscoped run reference; using a session string to infer ancestry; treating a run as a durable task |
| `TaskId` | Task Ledger | One user-visible task fact within its owning ledger/workspace | Survives attempts, retries and sessions; status/removal belongs to Task Ledger | `taskNodeId`/`taskLedgerNodeId` references from runs, Workboard and projections | A bare runtime/browser/install task ID, cron run ID, scheduling authority, or a second task store |

### Legacy field compatibility

| Existing field | Meaning at its existing boundary | Rule for a new boundary |
| --- | --- | --- |
| `workspaceKey` | Owner-specific workspace grouping key; some old resource producers use a root path or an unrelated fallback | Resolve it with the workspace owner first. The shared adapter accepts it only as the owner's legacy spelling of a resolved WorkspaceId; conflicting `workspaceId`/`workspaceKey` values are rejected. It never consults `sessionKey`. |
| `sessionId` | Endpoint-specific physical transcript/runtime session ID or browser/terminal session token | Do not globally rename it to SessionKey. Obtain the logical conversation key from the existing session owner; browser and terminal IDs remain in their own domains. |
| `taskNodeId`, `taskLedgerNodeId` | A reference to the existing Task Ledger node | Carry TaskId in new typed references, retaining the existing wire key when adapting an old endpoint. |
| `runtimeTaskId` | A runtime scheduling/dispatch item | Keep its runtime owner; optionally reference a Task Ledger node one-way. It is not TaskId. |
| bare `taskId` | An old endpoint may mean a ledger projection, browser job, office installer or runtime item | Owner is determined by that endpoint, never by the string value. The new adapter rejects this ambiguous key; explicitly translate it to `taskNodeId`, `runtimeTaskId`, `browserTaskId`, `cronRunId` or `installTaskId` at the compatibility boundary. |
| `runId` without scope | Existing endpoint-local token whose owner may be implicit in its route/store | Keep existing persistence intact. Before a new cross-boundary reference or persistence call, carry explicit RunScope with the token. |

`shared/types/identity-scope.ts`, re-exported by the existing
`shared/product-semantics.ts`, is the single compatibility module. Its five brands
erase to the original strings: no prefix, UUID, case, whitespace or storage key is
rewritten. `resolveProjectIdForWorkspace()` projects a WorkspaceId to a distinct
ProjectId with the same bytes for the transition only.
`resolveWorkspaceIdForProject()` also requires the owner's WorkspaceId and rejects
a mismatched pair; it cannot discover an execution root from an arbitrary project.

`normalizeRunScope()` requires `runId` and a scope containing a resolved
`workspaceId` (or its explicit legacy `workspaceKey`). A missing ProjectId uses the
central transitional mapping; an explicit ProjectId remains an owner-supplied
association. SessionKey is optional metadata, never a substitute for that scope.
It returns an in-memory `ScopedRunId`; it neither writes storage nor infers parent,
retry or attempt lineage. `normalizeTaskReference()` requires an explicit kind and
the matching owner-specific field, and rejects bare or mixed task keys.

The executable boundary is opt-in for new callers: branded type checks and negative
normalization tests guard against new identity confusion. Existing raw host-api
payloads remain compatibility surfaces. The browser resource-envelope fallback was
removed: `electron/services/agent-browser-api.ts` resolves the active workspace id
before opening a session and uses the explicit host-global scope only when no
workspace is active. It never aliases session keys into workspace identity. Other
raw compatibility payloads still require migration before the project may claim
whole-system identity convergence.

TF-0372 supplies no Project store, new Task/Run/Trace/Goal/Memory authority, execution
protocol, permission provider or full OS sandbox. Frozen boundaries remain
`liveReady=false`, `productApproved=false`, `defaultOn=false`, C1 keep-off,
Runtime Memory diagnostics-only and SEKB auto-writeback disabled.

## Session lifecycle action boundary

Session lifecycle actions are separate facts. An abort is not a stop, stop is not
archive, archive is not delete, and reset changes the physical generation without
creating a new logical conversation by string inference. The current source
anchors, inheritance rules, failure states and known gaps are recorded in
[`long-session-development/a1/action-and-inheritance-contract.json`](../harness/specs/fixtures/long-session-development/a1/action-and-inheritance-contract.json).
The corresponding negative cases are fixed in
[`negative-scenario-index.json`](../harness/specs/fixtures/long-session-development/a1/negative-scenario-index.json).
That fixture is a current fault baseline, not evidence that every lifecycle path
is already protected.

| Action | Visible behavior | Inherits | Does not inherit / required boundary |
| --- | --- | --- | --- |
| Turn/run abort | Stops the active turn/run and reloads transcript state. | SessionKey, transcript, current physical session until a separate reset. | Task/goal completion or resource deletion. |
| Session stop | Clears queued work and drains runtime activity while retaining the session. | SessionKey, session store, transcript and task/resource records. | Archive/delete mutation or task completion. |
| Archive | Hides a conversation from the live list while retaining it for restore. | Transcript, original session-entry snapshot and original workspace/folder hints. | Running process ownership, task completion or a new SessionKey. |
| Restore | Restores an archive-indexed conversation to the live list. | Snapshot metadata and transcript. | A restored task/goal status or running resource ownership. |
| Reset | Rotates the physical sessionId/generation under the same SessionKey. | Agent/workspace scope, label/origin preferences and Task Ledger references. | Old run/generation authority, ordinary-session CLI bindings and token counters. |
| Delete | Permanently removes a live or archived conversation after owner cleanup. | No restore entitlement after a committed delete. | Late run authority, task completion or a second deletion owner. |
| Fork | Creates a new child session from a source transcript. | Transcript/model/workspace preferences and explicit fork lineage. | Task/goal completion or running resources. |
| Handoff | Builds a bounded draft and creates a child session without mutating the source. | Bounded handoff context and explicit parent/root lineage. | Goal transfer, source mutation or resource drain. |
| Schedule pause | Disables future Cron/Workboard triggers. | Existing session/history and current-run state. | Session stop, abort, archive/delete or task completion. |

Archive and restore now execute through the runtime lifecycle owner. Archive
acquires the existing admission fence, drains the session, records an immutable
operation intent, writes the archive index and transcript, and only then commits
the hidden store state. Restore inserts a fresh physical generation under the same
SessionKey, reverses the archived transcript/index, and leaves the old generation
tombstoned so late events cannot mutate the restored row. A failed or unknown RPC
keeps the Main operation gate and the same operationId open for retry; archived
keys are filtered from the live session list before the store-row commit is
complete. The A1 contract remains a historical fault baseline and therefore keeps
its original `partial` status for those rows.

This boundary adds no Project, Task/Goal, Context/Memory, Scheduler or universal
resource authority. Permanent deletion of an already archived conversation still
uses the archive index as its retry locator and must not report success while an
owned derivative remains.

## Effective session policy

`SessionEffectivePolicy/v1` is a read-only projection of the current session
owner facts. It keeps configured values, effective values, unverified values,
unsupported capabilities and ignored overrides in separate states. Effective
facts come from the bounded TF-0512 `ModelCapabilityProfile/v1` observation for
the same workspace/session and a matching runtime generation; a missing, stale or
mismatched observation leaves effective values unknown. The projection never
substitutes a JSON file, an `enabled` flag, a provider label or a stale receipt
for runtime evidence.

The policy reports backend, native binding, model/effort, workspace grant,
action authorization, context/queue/resource/schedule limits and their sources.
Codex app-server and Claude CLI own native compaction; their compatibility rows
mark OpenClaw compaction overrides as ignored with a reason. OpenClaw embedded
sessions retain OpenClaw-owned compaction. Resource and schedule owners are not
copied into a second registry, and the policy contains no credentials, auth
profile IDs, raw prompts or transcript text. Reading it performs no execution,
config write or grant expansion. Executable fixtures are under
[`long-session-development/b1/`](../harness/specs/fixtures/long-session-development/b1/).

## Coordinator binding and delegation admission

Long-session coordination is an explicit Workspace-owned capability, not an
automatic mode of ordinary Chat. The current binding stores only the selected
Workspace/Assistant, logical SessionKey, observed physical `sessionId`, existing
Task Ledger node references and a monotonically increasing revision in the
Workspace store. A reset changes the physical generation and invalidates the old
binding; archive/delete invalidate it through the existing session lifecycle
owners. The binding contains no Project store, Task/Goal status, raw transcript
or execution authority.

`DelegationAdmissionReceipt/v1` reuses the existing role orchestrator and child
session runtime. Before invoking `orchestrator.run`, Main persists a bounded
`submitting` receipt keyed by caller idempotency key and request digest. The final
receipt binds the coordinator revision/physical generation, Task Ledger ref,
role, child session/run, actual backend identity, role-clamped tool allow/deny
facts and isolation backend. `accepted` means the runtime admitted the child; it
is not `running`, `completed` or task completion. Unknown role, unsupported
backend, stale coordinator generation and missing child identity remain rejected
or unknown facts.

Shared in-process writers run serially unless an explicit write-set path is
provided; worktree isolation records whether the actual backend is `git` or the
in-process fallback. A reset/stop racing admission is rechecked after spawn and
the child stop is requested rather than projecting a phantom completion. The C4
entry is still required before users can operate this capability from the main
product surface.

Completion continuation reads the existing subagent registry and delivery outbox rather than starting a second scheduler. Workers of one orchestration run form a bounded batch keyed by `completion-batch:<orchestrationRunId>:<requesterSessionKey>`; completed, failed, cancelled and missing workers remain distinct, and a deferred verifier must also become terminal before the team bundle can be exposed. Delivery remains at-least-once, but the deterministic key, per-run delivery state and requester physical-generation pin make replay idempotent and prevent a reset/handoff generation from accepting stale work. The batch receipt reports task completion authority as `none`; final model text alone is not delivery evidence. The user-visible C4 entry is still required before this runtime capability becomes an operable product surface.

The C4 long-session surface reuses the existing Sidebar and Chat activity rail rather than creating a second task list. An explicitly bound coordinator conversation is marked in the Sidebar and remains openable even before its first message. The activity rail projects the Workspace binding revision and invalidation reason, existing Task Ledger references, durable delegation receipts, worker transcripts and completion-batch delivery state. Pause/resume actions delegate to the existing composer run controls and disappear once the binding is invalidated. Task acceptance still comes only from Task Ledger, and completion delivery remains at-least-once with the C3 generation fence.

Long-session continuity strategy stays on the baseline: the paired evaluation contract froze a 30-pair agent-driven workload and measured only structural projection behaviour because no live provider was authorized, so no continuous-compression, value-pruning or summary-tree path is default-enabled, promoted or implied by the long-session surface. Any future promotion needs a live-provider sample that clears the published fidelity, safety, cost and P95 gates plus its own implementation spec, rollback and failure fallback; see [d3 decision evidence](../harness/specs/fixtures/long-session-development/d3/continuity-strategy-decision.json).

Memory is one reviewable product concept. Role Memory cards, Runtime Memory facts/timelines/episodes, the candidate queue, embedding indexes, native-file retrieval and Dreaming caches have distinct implementation lifecycle and storage owners, but they are not separate product memories. Candidates and derived caches are never retrievable or injectable as accepted memory; role-card review or the owning Runtime Memory acceptance path must promote them first. The canonical domain matrix and migration boundary live in [memory-control-plane.md](dev/memory-control-plane.md). SEKB remains a Knowledge Runtime Lessons source and does not own a memory store.

## Windows x64 Controlled Preview

The current first-product validation target is **Verse Claw Windows x64 - DCS Coding Controlled Preview**. It is an internal, single-workspace path with explicit opt-in, runtime acknowledgement, controlled writes, undo, restart recovery, kill/rollback, and a redacted support bundle. FP-P1 evidence is engineering and real-process evidence; release approval remains pending, and no real-human evidence is claimed.

The table below is the canonical component classification for this preview. Each component appears exactly once and has exactly one label. Other documents should link here instead of assigning another label.

<!-- FP-P1-08-COMPONENT-STATUS-START -->
| Component | Canonical label | Boundary |
| --- | --- | --- |
| DCS coding loop | `opt-in` | The first-product switch is off by default and requires verified provider, model, workspace, and permission prerequisites. |
| Workspace Context | `default` | One Settings > General profile composes a bounded recent-action working window and compact tool/resource registry. It defaults on, follows the shared turn budget, and is controlled by one toggle; it is not long-term knowledge or approved memory. |
| DCS Fact view tools | `default` | Context read/search/understand tools are discovered automatically when the workspace, FactService and permissions are healthy. The env flag remains an explicit rollback/override, not a product enablement step. |
| VToken turn assembly | `retired` | The provider A/B fell below the predeclared materiality bar. Production assembly and the bridge are inert; rollback requires a new frozen protocol and another materiality pass. |
| SEKB automatic writeback | `deferred` | Explicit review remains the only allowed write path; shadow candidates cannot apply or overwrite knowledge. |
| C6 automatic context ladder | `internal` | Explicit internal assembler request API for tests and diagnostics; there is no automatic or user-level activation. |
| C7 knowledge/routing cutover | `deferred` | Shadow evidence does not grant routing authority. |
| Coding WAL | `default` | The write journal remains the recovery authority for supported coding writes; stale-write guard and auto-verification report explicit failures rather than silently retrying. |
| Browser supervised workflows | `advanced` | Supervised browser tasks are available as an advanced capability; private-network navigation remains default-deny and always needs a bounded session/origin approval. |
| Runtime Memory injection | `diagnostics-only` | Diagnostics and the review surface are available, but candidate facts do not enter the production model prompt. |
| Surfaces listed in RETIRED-SURFACES.md | `retired` | Removed surfaces stay removed and cannot be used as current capability evidence. |
<!-- FP-P1-08-COMPONENT-STATUS-END -->

The table above is the current controlled-preview component classification after the 2026-10-24 graduation pass. Every changed label is backed by the owning node's production path, rollback, model-effective-state and agent-driven evidence; TF-0506 only synchronizes those decisions into user-facing and release-facing text. Under the 2026-09-27 owner policy, real-human evidence is not a prerequisite and is not claimed. The excluded, deferred and default-deny details remain locked by `docs/dev/default-config-matrix.md`, `docs/dev/first-product-controlled-preview/STATUS.md`, and the [D9 scope ADR](dev/adr/2026-10-21-d9-component-graduation-scope.md).

## Component Graduation Scope (D9)

D9 moves the current internal workstream from showcase-only closing to evidence-backed component graduation without changing the release boundary. In scope are component inventory and disposition, the decision path for default/advanced/internal/experiment/retired outcomes, model-facing capability self-description, and agent-driven automatic acceptance. Default graduation means the owning node may change a specific product default after its predeclared gates pass; it does not create a blanket enablement path.

The following boundaries remain outside automatic authority after the graduation pass:

- public release, general availability, live readiness, or product approval;
- any product-lock change or product default without a matching owner decision and evidence;
- VerseGit nodes, worktrees, and product files;
- treating an internal, retired, experiment or shadow classification as proof that its implementation or migration work was completed.

“Default graduation” means a component can be evaluated and decided into a default mode through the component evidence matrix; it is not a blanket enablement or an automatic value flip, and public release, general availability, live readiness and product approval remain unauthorized. “Automatic acceptance” means an agent can execute checks, write evidence, and read results back from disk. It does not grant release approval. A green test, a wiring site, or a completed Task Forest node is necessary evidence, not a substitute for production-path, benefit, rollback, effective-state, and explicit-decision evidence.

Agent evidence must remain `driven_by: agent` with a concrete actor. Zero real-human evidence is a retained fact, not an open/blocked condition. See the [D9 ADR](dev/adr/2026-10-21-d9-component-graduation-scope.md) and the [current constraint matrix](dev/component-graduation-scope-matrix-20261021.md).

## Session lifecycle action boundary

Session lifecycle actions are separate facts. An abort is not a stop, stop is not
archive, archive is not delete, and reset changes the physical generation without
creating a new logical conversation by string inference. Source anchors,
inheritance rules, failure states and the original fault baseline are recorded in
[`long-session-development/a1/action-and-inheritance-contract.json`](../harness/specs/fixtures/long-session-development/a1/action-and-inheritance-contract.json).
The corresponding negative cases are fixed in
[`negative-scenario-index.json`](../harness/specs/fixtures/long-session-development/a1/negative-scenario-index.json).

| Action | Visible behavior | Inherits | Does not inherit / required boundary |
| --- | --- | --- | --- |
| Turn/run abort | Stops the active turn/run and reloads transcript state. | SessionKey, transcript and current physical session. | Task/goal completion or resource deletion. |
| Session stop | Clears queued work and drains runtime activity while retaining the session. | SessionKey, session store, transcript and task/resource records. | Archive/delete mutation or task completion. |
| Archive | Hides a conversation while retaining it for restore. | Transcript, original session-entry snapshot and workspace/folder hints. | Running process ownership, task completion or a new SessionKey. |
| Restore | Restores an archive-indexed conversation. | Snapshot metadata and transcript. | Task/goal status or running resource ownership. |
| Reset | Rotates the physical sessionId/generation under the same SessionKey. | Agent/workspace scope, preferences and Task Ledger references. | Old generation authority, ordinary-session CLI bindings and token counters. |
| Delete | Removes a live or archived conversation after owner cleanup. | No restore entitlement after a committed delete. | Late run authority, task completion or a second deletion owner. |
| Fork | Creates a child session from a source transcript. | Transcript/model/workspace preferences and explicit fork lineage. | Task/goal completion or running resources. |
| Handoff | Creates a child from a bounded draft without mutating the source. | Bounded context and explicit parent/root lineage. | Goal transfer, source mutation or resource drain. |
| Schedule pause | Disables future Cron/Workboard triggers. | Existing session/history and current-run state. | Session stop, abort, archive/delete or task completion. |

Archive and restore execute through the runtime lifecycle owner. Archive acquires
the admission fence, drains the session, records an operation intent, writes the
archive index and transcript, then commits the hidden store state. Restore uses a
fresh physical generation under the same SessionKey and keeps the old generation
tombstoned. Failed or unknown RPCs retain the same Main operationId for retry.
The A1 contract retains its original `partial` fault-baseline status; it is not
rewritten as evidence that every historical path was protected.

This boundary adds no Project, Task/Goal, Context/Memory, Scheduler or universal
resource authority. Deleting an archived conversation retains its archive-index
retry locator and cannot report success while an owned derivative remains.

## Final acceptance scope (F3)

The long-session capability is accepted inside one explicit boundary on Windows x64:
a single bound coordinator Workspace/Assistant/session tree, the existing Task Ledger
as the only task-fact owner, and the existing completion, admission, resource and
scheduler owners. The retained peer evidence is read from disk:
`harness/specs/fixtures/long-session-development/f3/acceptance.json` and
`acceptance.md` list every execution node with its candidate, commands, exit codes,
counts, artifacts and negative proof.

What the accepted boundary proves:

- Lifecycle actions stay distinct (abort, stop, archive, restore, reset, delete, fork,
  handoff, schedule pause); archive/restore use the runtime lifecycle owner with an
  operation journal and retry identity. Late events cannot resurrect a deleted or
  rotated generation.
- Session effective policy reports configured, effective and actual backend as
  separate facts; unsupported or unknown combinations remain visible.
- An explicitly bound coordinator keeps its binding, physical generation and Task
  Ledger references across app/Gateway restart. Delegation admission records
  accepted only, and the activity rail shows completion batches without creating a
  second task list.
- Accepted-only, bounded `ContinuityContextPack/v1` projects existing owners. It
  creates no second memory store or injection authority.
- Coordinator follow-ups reject expired, missing, unverifiable or mismatched
  generations before execution. Main disables stale schedules instead of deleting
  them.
- Hidden read-only surfaces issue no work. Deletion reclaims owned terminals,
  browsers and managed ports through their existing owners; unresolved ownership
  retains a recovery identity.

The retained acceptance explicitly does not claim:

- **No live-provider or native-backend thread continuity.** The retained D2
  measurement is `EVIDENCE_INSUFFICIENT`, and D3 is `keep-baseline`. Provider quality,
  cost and P95 promotion evidence was not measured in that run; no asynchronous
  compression strategy or cross-vendor thread resumption is promoted. Manual/native
  compaction remains the default. Long-session continuity strategy stays on the baseline: the paired evaluation did not establish a promotion claim, so continuity remains descriptive and cannot become an asynchronous compression or cross-vendor resumption default.
- **No macOS, Linux or packaged-build long-use measurement.** The 333-session /
  57.16 MiB fixture and five-minute idle-RSS curve are a Windows x64 built
  `dist-electron` sample.
- **No real-human long use.** The artifacts are agent-driven and the fixture is
  synthetic.
- **No publication, product-lock or default change, and no independent Project or
  cloud/VPS/daemon execution scope.** These remain separate owner decisions.
- **No universal resource authority.** Unresolved worktree ownership retains its
  failure and recovery identity; no second registry is created.

## Concept Boundaries

| Concept | Role | Source of truth | Boundary |
| --- | --- | --- | --- |
| Chat | Immediate user/agent collaboration | Conversation transcript | May suggest a Task Loop upgrade, but does not automatically become Task Loop. |
| Plan mode | Permission-gated planning posture | Workspace permission decision | Controls user-file writes. System metadata writes are explicit exceptions, so do not claim strict no-diff. |
| Chat Plan | Projection of orchestration intent plus lightweight edit draft | Orchestrator plan output plus Task Ledger `projectionEdit` metadata | Can project to Task Ledger nodes and save reorder/disable/note edits, but is not a full DAG editor. |
| Task Ledger | App/user-visible task fact ledger | User-visible task facts | Owns goals, task nodes, checkpoints, evidence, and review facts. It is not a plugin scheduler. |
| Workboard | Runtime/plugin scheduling board | Runtime/plugin scheduling state | May reference a Task Ledger node id one-way. It must not mirror or two-way-sync Task Ledger. |
| Task Loop | Explicit high-constraint execution loop | Task Ledger root plus loop run state | Owns checkpoint, repair, blocked, and evidence-gate semantics. Ordinary orchestration must not borrow these claims. |
| Routing Memo | Routing observation memo | Observed routing outcome plus quality state | `null` means not evaluated, `shadow` means observed but not routing-affecting, `active` means scorecard-backed and allowed to affect routing. |

## Unsafe Claims

Do not publish these claims without changing the product and tests first:

- Chat exposes a full editable Chat DAG.
- Ordinary Chat automatically starts or enters Task Loop.
- Ordinary `team_orchestrate` returns complete or active quality scoring.
- Routing Memo learns role quality by default.
- Plan mode provides strict no-diff execution for every write.
- Passing component acceptance or producing agent evidence grants public release, general availability, live readiness, product approval, or a product-default change.

## Minimal Interfaces

- `PermissionDecisionEvent` records workspace mode, role, tool, boundary, decision, reason, and request id without replacing the existing permission systems.
- `TaskLedgerReference` is one-way from Workboard/runtime/plugin scheduling state to a Task Ledger node id.
- `projectionEdit` records lightweight Chat Plan reorder/disable/note edits in Task Ledger metadata without granting arbitrary edge editing.
- `OrchestrationQualityState` is `null | shadow | active`; ordinary orchestration may produce shadow scorecards, and only `active` may affect Routing Memo.
- `TaskLoopUpgradeSuggestion` is a Chat-visible suggestion. User confirmation is required before creating a Task Ledger root or starting `task_loop.run`.

## P0/P1 Planning Boundaries

Canonical task-level semantics live in `PRODUCT_SEMANTIC_TASK_BOUNDARIES` in `shared/product-semantics.ts`. Every P0/P1 task is semantically positioned even when its implementation remains `todo` or `defer`.

| Lane | Tasks | Product boundary |
| --- | --- | --- |
| Architecture drift | P0-00 | Running architecture and evidence win over stale knowledge-base claims. |
| Claim governance | P0-01, P0-02, P0-03, P0-05 | Public claims must pass matrix, artifact, and unsafe-claim gates. |
| Runtime evidence | P0-04, P0-10 | Core execution, trace, graph, and history evidence stay separated. |
| Observability | P0-06, P0-07 | Trace/query evidence is scoped; it is not a complete audit product claim. |
| Chat history | P0-08 | Startup recovery may use transcript fallback; direct `chat.history` is not guaranteed never to fail. |
| Execution graph | P0-09 | Graph projections are useful execution views, not full audit-chain proof. |
| Permission boundary | P0-11, P0-12, P0-13 | Plan mode gates user-file writes and has a focused Electron write/edit/exec challenge for terminal, file write, and mutating Gateway RPC. Wired Workspace and Role producers emit normalized `PermissionDecisionEvent` records; this is not an exhaustive enterprise audit system. |
| Backend boundary | P0-14 | Renderer must stay behind host-api/api-client and Main-owned transport. |
| Provider config | P0-15, P0-16, P0-17 | DeepSeek flash drift is closed for validated paths; future provider switching is not globally productized. |
| Chat Plan | P1-01, P1-02 | Chat Plan supports read-only projection plus lightweight edit drafts for reorder, disable, note, regenerate, save, and cancel. It is not a full DAG editor. |
| Task Ledger / Workboard | P1-03 | Task Ledger owns user-visible task facts; Workboard owns runtime/plugin scheduling and references ledger nodes one-way through `TaskLedgerReference`. |
| Orchestration quality | P1-04 | Ordinary `team_orchestrate` reports `qualityState=null` when unevaluated and `shadow` when scorecard evidence exists; active routing remains gated. |
| Orchestration diagnostics | P1-05 | Ordinary orchestration now exposes diagnostics and recommended next steps; repair/blocked/checkpoint semantics still belong only to Task Loop. |
| Routing Memo | P1-06, P1-07 | Routing Memo exposes internal diagnostic evidence; a shadow observation is non-routing and active routing authority requires same-session scorecard-backed quality. |
| Chat to Task Loop | P1-08 | Ordinary Chat may suggest upgrade; user confirmation is required before root/run creation. |
| Task Loop | P1-09 | Task Loop owns checkpoint, repair, blocked, and evidence-gate semantics. |
| Sensitive boundary | P1-10, P1-11, P1-12, P1-13, P1-14 | File, transcript, trace, memory, compaction, and model echo surfaces have separate guarantees. |

Implementation status is not the same as semantic status:

- `done`: behavior/evidence exists within the stated boundary.
- `todo`: boundary is positioned, but implementation still must be developed and tested.
- `defer`: boundary is positioned, but not a blocker for the current core product path.

## Implementation Order

1. Lock Task Ledger and Workboard source-of-truth semantics.
2. Keep Chat Plan as a bounded projection/edit draft into Task Ledger, not a full DAG editor.
3. Replace ambiguous ordinary orchestration quality claims with explicit null/shadow/active quality state.
4. Keep ordinary orchestration failure handling as diagnostics unless Task Loop is explicitly running.
5. Add explicit Chat to Task Loop upgrade UX before any automatic state-machine behavior.
6. Normalize permission decision audit events.
7. Limit plan editing to lightweight controls; do not build a full DAG editor.

The long-session control plane separates human UI/CLI intent, typed host lifecycle calls and scoped model tools. Resume, fork, archive, delete, environment/worktree selection and handoff use the existing host owners. A model shell command does not create lifecycle authority. Archive and restore run through the runtime admission/finalizer and preserve the operation identity across unknown outcomes. An explicit coordinator binding is stored as minimal metadata on the existing Workspace owner. It references existing Task Ledger nodes, binds the stable Workspace/Assistant/SessionKey to a canonical local checkout or Git-registered worktree, and records the observed branch, detached state, setup profile, binding revision and archive policy. Chat sends use that canonical environment and its fingerprint; reset generations, invalid or paused bindings, missing owners/environments, and revision conflicts fail closed. The binding never mutates task status; completion remains a Task Ledger operation.

The Session status panel projects `SessionEffectivePolicy/v1` from the existing session, configuration, model and resource owners. Configured runtime/model/limits are kept separate from current-run effective facts. `ModelCapabilityProfile/v1` observations are bounded, session/run/gateway-generation checked and used only by the matching current run; missing or stale observations leave effective backend, model, grants, context and admission facts unverified. The policy contains counts and normalized capabilities, not prompts, credentials, secrets or grant identifiers. Reading it does not execute a model, write configuration or expand authorization. The status panel exposes sources, compatibility/override reasons and normalized action permissions in the same disclosure. It also distinguishes run abort from session stop, the panel's view-only retention of completed activity from transcript and runtime-resource TTLs, and transcript-only session forks from Git worktree isolation. Activity, policy, and lifecycle facts are scope-checked during refresh so a response for an older workspace, run, Gateway generation, or request cannot replace the current selection.

Codex and Claude CLI advertise native compaction ownership; OpenClaw consumes its own compaction parameters. The policy compatibility table therefore marks native-backend automatic compaction, provider and model arguments as ignored with a reason, reserve-token arguments as unsupported where the native backend does not consume them, and manual compaction as effective through the backend owner. The UI renders these outcomes as localized status and reason rows while preserving backend-provided source identifiers for inspection.
