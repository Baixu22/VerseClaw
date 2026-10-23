# ClawX Product Semantics

Last updated: 2026-10-21

Evidence boundary: this document is a product-semantics guardrail that complements `shared/capability-claims.ts` and `artifacts/capability-claims/status-table.json`.

## Positioning

ClawX is an agent workbench, not an automatic project manager. Ordinary Chat is for immediate collaboration. Durable task facts belong to Task Ledger. High-constraint execution belongs to explicit Task Loop runs. Runtime/plugin scheduling belongs to Workboard. Routing Memo stays shadow until scorecard-backed quality input can safely affect routing.

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

## Windows x64 Controlled Preview

The current first-product validation target is **Verse Claw Windows x64 - DCS Coding Controlled Preview**. It is an internal, single-workspace path with explicit opt-in, runtime acknowledgement, controlled writes, undo, restart recovery, kill/rollback, and a redacted support bundle. FP-P1 evidence is engineering and real-process evidence; release approval remains pending, and no real-human evidence is claimed.

The table below is the canonical component classification for this preview. Each component appears exactly once and has exactly one label. Other documents should link here instead of assigning another label.

<!-- FP-P1-08-COMPONENT-STATUS-START -->
| Component | Canonical label | Boundary |
| --- | --- | --- |
| DCS coding loop | `opt-in` | The first-product switch is off by default and requires verified provider, model, workspace, and permission prerequisites. |
| DCS Fact view and tool registry | `opt-in` | Available only after explicit flags and runtime acknowledgement; not part of the baseline tool catalog. |
| VToken turn assembly | `opt-in` | Explicit Developer/config enable only; the enhancement kill switch wins. |
| SEKB automatic writeback | `deferred` | Human-confirmed review remains the only allowed write path. |
| C6 automatic context ladder | `deferred` | No automatic assembler activation in this preview. |
| C7 knowledge/routing cutover | `deferred` | Shadow evidence does not grant routing authority. |
| Coding WAL | `deferred` | Write journal remains the recovery authority for this preview. |
| Browser supervised workflows | `experimental` | Supervised use only; unsupervised and private-network expansion are excluded. |
| Runtime Memory injection | `diagnostics-only` | May expose diagnostics, but does not enter the first-product production injection path. |
| Surfaces listed in RETIRED-SURFACES.md | `retired` | Removed surfaces stay removed and cannot be used as current capability evidence. |
<!-- FP-P1-08-COMPONENT-STATUS-END -->

The table above is the controlled-preview baseline snapshot. Its labels remain the current runtime baseline until a component-specific graduation decision changes both behavior and documentation; TF-0488 changes neither. Under the 2026-09-27 owner policy, real-human evidence is no longer a prerequisite; agent-driven evidence may support a later decision only when it records `driven_by: agent` with a concrete actor and is backed by the current production path, rollback, and model-effective-state evidence. The excluded and default-off details remain locked by `docs/dev/default-config-matrix.md`, `docs/dev/first-product-controlled-preview/STATUS.md`, and the [D9 scope ADR](dev/adr/2026-10-21-d9-component-graduation-scope.md).

## Component Graduation Scope (D9)

D9 moves the current internal workstream from showcase-only closing to evidence-backed component graduation without changing the release boundary. In scope are component inventory and disposition, the decision path for default/advanced/internal/experiment/retired outcomes, model-facing capability self-description, and agent-driven automatic acceptance.

The following boundaries remain outside automatic authority and are not changed by TF-0488:

- public release, general availability, live readiness, or product approval;
- any product-default or product-lock change;
- VerseGit nodes, worktrees, and product files;
- implementation of TF-0489 or any later Context, Memory, Knowledge, Capability, Browser, or VerseShell node before that node is explicitly activated.

“Default graduation” means a component can be evaluated and decided into a default mode through the component evidence matrix; it is not a blanket enablement or an automatic value flip. “Automatic acceptance” means an agent can execute checks, write evidence, and read results back from disk. It does not grant release approval. A green test, a wiring site, or a completed Task Forest node is necessary evidence, not a substitute for production-path, benefit, rollback, effective-state, and explicit-decision evidence.

Agent evidence must remain `driven_by: agent` with a concrete actor. Zero real-human evidence is a retained fact, not an open/blocked condition. See the [D9 ADR](dev/adr/2026-10-21-d9-component-graduation-scope.md) and the [current constraint matrix](dev/component-graduation-scope-matrix-20261021.md).

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
| Routing Memo | P1-06, P1-07 | Routing Memo exposes shadow dashboard evidence, and active routing authority requires scorecard-backed quality. |
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
