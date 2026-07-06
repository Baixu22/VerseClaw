# ClawX Product Semantics

Last updated: 2026-07-06

Evidence boundary: this document is a product-semantics guardrail that complements `shared/capability-claims.ts` and `artifacts/capability-claims/status-table.json`.

## Positioning

ClawX is an agent workbench, not an automatic project manager. Ordinary Chat is for immediate collaboration. Durable task facts belong to Task Ledger. High-constraint execution belongs to explicit Task Loop runs. Runtime/plugin scheduling belongs to Workboard. Routing Memo stays shadow until scorecard-backed quality input can safely affect routing.

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
