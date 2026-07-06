# Fable5 Engineering Solution Report Prompt

Purpose: turn `report-authenticity-audit-2026-07-04.md` and `report-authenticity-followup-plan-2026-07-04.md` into a concrete engineering solution report.

Note: the prompt below intentionally uses neutral product and engineering language. It is framed as productization solutions, module mapping, runtime confirmation, and delivery sequencing.

## Copy-Paste Prompt For Fable5

You are Fable5. Act as a senior engineering solution designer. Based on the current repository and the audit documents, produce a "Capability Productization Solution Report".

Please keep this as read-only analysis. Do not modify code. Do not run long tasks. For code location, prefer the local `codegraph` CLI, not an MCP service. If `codegraph` is unavailable, skip it and use `rg` plus direct source reading.

Primary objective:

Use the audit findings and follow-up questions to generate concrete solutions. The final output must be a deliverable report, not only a list of observations. For each major audited gap, explain the current state, the intended product behavior, the recommended solution, involved modules, implementation steps, acceptance criteria, and open confirmations.

The report should answer the user's core question:

> Given the audit report, what should we build or connect next, and how should it be engineered?

Input documents:

- `reports/report-authenticity-audit-2026-07-04.md`
- `reports/report-authenticity-followup-plan-2026-07-04.md`

Language and framing constraints:

- Use neutral terms such as "productization gap", "access boundary", "data flow", "runtime confirmation", "redaction coverage", "quality signal", "call-chain reachability", and "stability consideration".
- Keep the task framed as product planning and architecture mapping.
- Do not ask to write real sensitive values. If an example value is needed, use `PLACEHOLDER_VALUE`.
- Do not expand scope into broad refactoring. Only output planning, phases, module lists, and acceptance criteria.
- Mark every conclusion with an evidence level: `source present`, `call chain reachable`, `needs runtime confirmation`, or `user reachable`.

Suggested CodeGraph commands:

```powershell
codegraph status
codegraph query OrchestrationPlanView --limit 10
codegraph query recordLongTaskCheckpoint --limit 10
codegraph query routingMemoPilot --limit 10
codegraph query reviewMemoryProposal --limit 10
codegraph query decideWorkspaceCommand --limit 10
codegraph query team_orchestrate --limit 10
codegraph query sanitizeTraceForPersistence --limit 10
codegraph query buildRolePermissionDenyList --limit 10
```

Known CodeGraph anchors:

- `src/components/agents/OrchestrationPlanView.tsx:68`: Chat-side orchestration plan display component.
- `src/components/agents/RolesOrchestrationPanel.tsx:54`: imports `OrchestrationPlanView`.
- `openclaw_runtime/src/agents/long-task-control/store.ts:440`: `recordLongTaskCheckpoint`.
- `openclaw_runtime/src/gateway/server-methods/chat.ts:57`: Chat server methods import the long-task control store.
- `openclaw_runtime/src/agents/routing-memo.ts:76`: `resolveRoutingMemoPilotMode`.
- `openclaw_runtime/src/config/types.openclaw.ts:225`: `runtime.orchestration.routingMemoPilot` config, including `off | shadow | active`.
- `openclaw_runtime/src/memory/gatekeeper.ts:281`: `reviewMemoryProposal`.
- `openclaw_runtime/src/memory/memory-store.ts:1208`: `reviewMemoryProposalRecord`.
- `electron/services/workspace-permissions.ts:171`: `decideWorkspaceCommand`.
- `electron/services/terminal-api.ts:18`: terminal service imports workspace permission logic.
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:1`: ordinary team orchestration tool.
- `src/stores/chat/helpers.ts:648`: Chat message enrichment for team orchestration results.
- `electron/services/observability-redaction.ts:107`: `sanitizeTraceForPersistence`.
- `electron/services/observability-index.ts:18`: Observability index imports redaction logic.
- `openclaw_runtime/src/agents/role-permissions-policy.ts:44`: `buildRolePermissionDenyList`.

Engineering questions to answer:

1. Chat Plan to Task Ledger / Workboard connection
   - Why is the current Chat plan only displayed as read-only UI?
   - How do Task Ledger node/edge/DAG capabilities relate to Workboard card/dependency capabilities?
   - For a minimal productized version, should the first slice be "create Task Ledger nodes from a plan" or "edit dependencies inside the plan view"?
   - Which components, host APIs, shared types, and i18n resources would need changes?

2. Routing Memo productization path
   - What do the `off / shadow / active` phases of `routingMemoPilot` mean?
   - Where is the current `qualityOverall` connection gap?
   - Which existing sources could provide quality signals: Task Loop evidence gate, worker outcome, user feedback, trace scorecard, or another existing surface?
   - Should the next iteration stay in shadow observation or expose active adjustment? Give a recommendation.

3. `team_orchestrate` quality signal completion
   - What is the practical effect of returning `quality: []` and an empty `qualitySummary`?
   - Which Task Loop mechanisms can be reused lightly, and which should stay separate?
   - Define the smallest useful delivery slice, such as worker outcome summary, spawn status aggregation, or route diagnostics display.

4. Checkpoint and resume boundary
   - What does `ResumeCheckpoint` store, and what does it not store?
   - How does checkpoint data relate to Task Ledger, session transcript, and runtime events?
   - How should product copy describe resume behavior so users understand it is not a complete execution snapshot?

5. Context compaction visibility
   - What are the current compaction/context-pruning trigger conditions and default thresholds?
   - Can users see status, summaries, or recovery hints today?
   - Should there be a lightweight UI surface showing "context organized", summary entry, and retained-item explanation?

6. Memory Gatekeeper user path
   - Where do proposals come from, how are they reviewed, and how do they move into active/cold/archive states?
   - How much management capability already exists in the Roles panel?
   - Should the next slice improve explanation, batch actions, conflict handling, or injection preview?

7. Workspace Permission and Role Permission priority
   - How do workspace mode and role tool allow/deny rules combine?
   - Which enforcement points are in Electron Main, and which are in runtime role context?
   - Would a permission matrix help future development?

Required deliverable:

Please output a single Markdown report titled:

`Capability Productization Solution Report`

The report must have this structure:

1. Executive Summary
2. Audit Finding To Solution Map
   - audit finding
   - current source-backed state
   - proposed solution
   - evidence level
   - recommended priority
3. Current Capability Layering
   - User reachable
   - Foundation present but not connected
   - Foundation missing
4. Key Call-Chain Diagrams, preferably Mermaid
   - Chat send
   - Team orchestration
   - Memory lifecycle
   - Observability trace persistence
5. Concrete Solution Designs
   - problem statement
   - target behavior
   - implementation approach
   - files/modules involved
   - data model or API changes
   - UI surface changes
   - acceptance criteria
6. Top 5 Productization Recommendations
   - User value
   - Engineering cost
   - Stability considerations
   - Involved files
   - Acceptance criteria
7. Phased Delivery Plan
   - Phase 1: read-only visibility and explanation
   - Phase 2: lightweight connection and persistence
   - Phase 3: feedback signal loop
8. Open Confirmations
9. Suggested Source Reading List
10. Final Recommended Next Step

Keep conclusions careful. If you only see source code, write `source present`. If you can identify callers, write `call chain reachable`. If actual execution is needed, write `needs runtime confirmation`. Do not treat static source presence as productized behavior.
