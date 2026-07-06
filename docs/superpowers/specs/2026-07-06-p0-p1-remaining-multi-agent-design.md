# P0/P1 Remaining Multi-Agent Design

Date: 2026-07-06
Worktree: `C:\Users\27933\Desktop\clawx\ClawX-knowledge-ux-polish`
Branch: `knowledge-ux-polish`

## Goal

Close the remaining unfinished P0/P1 product-semantics items without using the old
`codex/sekb-runtime-knowledge` branch and without turning semantic contracts into
false-positive product claims.

This design covers:

- `P0-12` Plan mode real write challenge E2E
- `P0-13` Unified permission audit event
- `P1-02` Lightweight Chat Plan editing
- `P1-03` Task Ledger and Workboard data relationship
- `P1-04` Ordinary orchestration quality state

`P1-05`, `P1-06`, `P1-07`, and `P1-08` are already marked `DONE` in the report
matrix. They remain boundaries for this work, not targets for redesign.

## Current Evidence

The authoritative matrix and product semantics currently show:

- `P0-12` is `defer`: unit-level Plan mode denial exists, but no Electron E2E
  performs a real write/edit/exec challenge.
- `P0-13` is `defer`: `PermissionDecisionEvent` exists as a normalized shape,
  but Workspace and Role permission systems do not yet produce a unified audit
  surface.
- `P1-02` is `todo`: Chat Plan projection exists and is read-only; no lightweight
  editing controls exist.
- `P1-03` is `todo`: `TaskLedgerReference` exists as a semantic contract and
  Workboard has a matching metadata field, but there is no shared protocol or
  sync boundary enforced by implementation tests.
- `P1-04` is `todo`: ordinary `team_orchestrate` and `orchestrator.run` correctly
  return `qualityState=null`; no real scorecard-backed ordinary quality producer
  exists.

## Design Principles

1. Do not claim implementation from type shape alone.
2. Keep Workspace permission and Role permission enforcement separate; add audit
   normalization around them.
3. Keep Chat Plan editing lightweight. It may reorder, disable, annotate, and
   regenerate a plan draft. It must not become a full DAG editor.
4. Keep Task Ledger as user-visible work facts and Workboard as runtime/plugin
   scheduling state. Workboard may reference a ledger node one-way only.
5. Keep ordinary orchestration quality honest. `null` means not evaluated,
   `shadow` means evidence exists but is not routing authority, and `active`
   requires scorecard-backed quality.

## Multi-Agent Collaboration Model

Use parallel agents for read-only investigation and review, then serialize
implementation to avoid conflicting edits.

### Agent A: Permission Boundary

Scope:

- `P0-12`
- `P0-13`

Primary files:

- `electron/services/workspace-permissions.ts`
- `electron/services/gateway-api.ts`
- `electron/services/files-api.ts`
- `electron/services/terminal-api.ts`
- `electron/services/permissions-api.ts`
- `openclaw_runtime/src/agents/role-permissions-policy.ts`
- `openclaw_runtime/src/agents/role-spawn.ts`
- `tests/unit/workspace-permissions.test.ts`
- `tests/unit/role-spawn.test.ts`

Output:

- Plan mode E2E test design and implementation.
- Minimal permission audit adapter design and implementation.

### Agent B: Chat Plan Editing

Scope:

- `P1-02`

Primary files:

- `src/components/agents/RolesOrchestrationPanel.tsx`
- `src/components/agents/OrchestrationPlanView.tsx`
- `src/lib/task-ledger-plan-projection.ts`
- `src/pages/TaskLedger/index.tsx`
- `tests/unit/orchestration-plan-ledger-projection.test.ts`
- `tests/unit/roles-orchestration-panel.test.tsx`

Output:

- Lightweight edit draft model.
- UI controls for reorder, disable/enable, note, regenerate.
- Task Ledger audit events for saved edits.

### Agent C: Task Ledger / Workboard Boundary

Scope:

- `P1-03`

Primary files:

- `shared/product-semantics.ts`
- `openclaw_runtime/extensions/workboard/src/types.ts`
- Task Ledger host-api/service files selected during implementation.
- Workboard tests selected during implementation.

Output:

- Shared `TaskLedgerReference` protocol.
- Workboard metadata normalization.
- Tests proving one-way reference semantics.

### Agent D: Orchestration Quality

Scope:

- `P1-04`

Primary files:

- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
- `openclaw_runtime/src/agents/orchestration-protocol.ts`
- `openclaw_runtime/src/observability/scorecard.ts`
- `tests/unit/role-orchestration-methods.test.ts`
- `tests/integration/p1-orchestration-boundary.integration.test.ts`

Output:

- Real ordinary orchestration scorecard producer.
- `qualityState` transition from `null` to `shadow` only when evidence exists.
- No active Routing Memo authority unless scorecard-backed quality is present.

### Agent R: Review and Claim Gate

Runs after each implementation step.

Checks:

- Does the change satisfy the product semantic item it claims?
- Does it preserve P1-05/P1-06/P1-07/P1-08 boundaries?
- Does it avoid false claims such as full DAG editing, default Routing Memo
  learning, or Task Loop repair semantics in ordinary orchestration?
- Are tests present at the right layer?
- Are docs and claim gates updated only when evidence supports the claim?

## Component Designs

### P0-12: Plan Mode Real Write Challenge E2E

Current state:

- `decideWorkspaceCommand`, `decideWorkspaceFileWrite`, and `decideGatewayRpc`
  block mutating operations in Plan mode at unit level.
- Existing Electron E2E verifies UI and payload behavior, but not real write/edit
  challenge paths.

Design:

- Add an Electron E2E spec, for example
  `tests/e2e/chat-plan-mode-write-challenge.spec.ts`.
- Launch with a mocked active workspace whose `permissionMode` is `plan`.
- Use Main host invoke paths rather than direct renderer IPC:
  - `terminal.run` with a mutating command.
  - `files.writeText` into a workspace file.
  - `gateway.rpc('tools.exec', { command: ... })` or an equivalent mutating RPC.
- Assert each request is blocked or approval-required according to the existing
  permission policy.
- Assert no real file write happens and no mutating Gateway RPC is forwarded.

Non-goals:

- Do not redesign Plan mode.
- Do not weaken permissions to make approval flows easier to test.
- Do not claim all possible write surfaces are exhaustively challenged unless the
  E2E actually covers them.

Acceptance:

- E2E fails before the test harness observes the correct block behavior.
- Existing unit permission tests still pass.
- Report matrix can move `P0-12` from `DEFER` to `DONE` only with command output
  from the new E2E.

### P0-13: Unified Permission Audit Event

Current state:

- `PermissionDecisionEvent` exists in `shared/product-semantics.ts`.
- Workspace approvals and audits exist through `permissions-api`.
- Role permissions map role contracts to hard tool allow/deny lists, but do not
  emit the normalized event shape.

Design:

- Add a small permission decision audit adapter, not a new permission system.
- Normalize events through the existing `createPermissionDecisionEvent` shape.
- Workspace producers:
  - Gateway RPC decisions from `gateway-api`.
  - File write decisions from `files-api`.
  - Terminal command decisions from `terminal-api`.
- Role producers:
  - Role permission deny-list construction from `role-permissions-policy`.
  - Role spawn context from `role-spawn`, with role name, tool, decision, reason,
    and request/run context where available.
- Consumer surface:
  - Reuse or extend `permissions-api` list behavior so recent normalized decision
    events can be inspected.
  - Store bounded recent events; do not create a second durable permissions
    database unless existing storage is insufficient.

Event fields:

- `kind: 'permission-decision'`
- `workspaceMode`
- `role`
- `tool`
- `boundary`
- `decision`
- `reason`
- `requestId`

Non-goals:

- Do not merge Workspace and Role permission enforcement.
- Do not add argument-level role command filtering as part of this item.
- Do not claim full enterprise audit coverage beyond the wired producers.

Acceptance:

- Unit tests cover event normalization and both producer families.
- At least one integration or E2E path shows a Workspace decision and a Role
  decision visible through the same consumer surface.
- Matrix wording changes from schema-only to minimal productized producers.

### P1-02: Lightweight Chat Plan Editing

Current state:

- `orchestrator.plan` can be projected to Task Ledger as read-only.
- Task Ledger can identify read-only orchestration projection nodes.
- There is no editing layer.

Design:

- Introduce a `PlanEditDraft` model in renderer-facing code:
  - `baseProjectionId`
  - `operations`
  - `updatedNodes`
  - `disabledNodeIds`
  - `notesByNodeId`
  - `order`
  - `auditReason`
- Supported operations:
  - Reorder siblings.
  - Disable or re-enable a planned node.
  - Add a note to a node.
  - Regenerate the whole plan through `orchestrator.plan`.
  - Save or cancel the draft.
- Saving appends Task Ledger events that preserve provenance:
  - Original projection remains marked `readonlyProjection=true`.
  - Saved edit metadata records `projectionEdit` with operation list.
  - Edits do not pretend to be the original runtime plan.

UI:

- Add controls inside the existing orchestration plan surface.
- Use compact icon buttons and familiar controls.
- Route all text through i18n.
- Do not build drag-and-drop arbitrary edge editing.

Non-goals:

- No full DAG editor.
- No arbitrary add/remove edge UI.
- No automatic Task Loop root creation from plan edits.

Acceptance:

- Unit tests cover draft operations and saved event shape.
- Component tests cover UI controls and save/cancel behavior.
- E2E covers a lightweight edit saved to Task Ledger.
- Product copy says "lightweight plan editing", not "full DAG editing".

### P1-03: Task Ledger / Workboard Data Relationship

Current state:

- `TaskLedgerReference` exists in `shared/product-semantics.ts`.
- Workboard has a matching `WorkboardTaskLedgerReference` type.
- No shared protocol makes one-way semantics enforceable across code and tests.

Design:

- Promote `TaskLedgerReference` as the canonical shared contract.
- Workboard metadata should either import the shared type or use a narrow adapter
  that validates the same shape.
- Direction is fixed:
  - `direction: 'workboard-to-task-ledger'`
  - Workboard card metadata may hold `taskLedgerReference`.
  - Task Ledger nodes do not mirror Workboard card state.
- Add normalization helpers:
  - validate `taskLedgerNodeId`.
  - optionally attach `workboardCardId`.
  - set `source` to `workboard`, `plugin`, or `runtime`.
- Add tests that reject or ignore two-way sync fields such as `sync`,
  `taskLedgerMirror`, or Workboard-owned task facts on Task Ledger nodes.

Non-goals:

- Do not build full Workboard/Task Ledger synchronization.
- Do not make Workboard the source of user-visible task facts.
- Do not make Task Ledger a plugin scheduler.

Acceptance:

- Unit tests prove the contract is one-way.
- Workboard metadata uses the shared reference shape.
- Docs and report matrix explicitly state no two-way sync exists.

### P1-04: Ordinary Orchestration Quality State

Current state:

- `team_orchestrate` and `orchestrator.run` return `quality: []`,
  `qualityState: null`, and a reason saying ordinary orchestration is not yet
  evaluated by a scorecard.
- `scoreWorkerQuality` exists, and observability trace scorecards exist, but they
  are not yet wired into ordinary orchestration output as reliable quality state.
- Routing Memo active authority is already gated by scorecard-backed quality.

Design:

- Add an ordinary orchestration scorecard producer that consumes real evidence:
  - worker spawn status and errors.
  - worker run/session ids.
  - result text where available.
  - verifier outcome where available.
  - observability trace scorecard id/grade/score.
  - existing `scoreWorkerQuality` output where there is real worker evidence.
- Produce a structured result:
  - `overall: 'good' | 'needs_attention' | 'poor_attempt'`
  - `worst`
  - `reason`
  - `evidenceRefs`
  - `workerScores`
  - `scorecardBacked`
- State transition:
  - `qualityState=null` when no real evidence exists.
  - `qualityState='shadow'` when scorecard evidence exists but must not affect
    routing.
  - `qualityState='active'` only when the same scorecard-backed rules required
    by Routing Memo are satisfied.
- Keep ordinary orchestration separate from Task Loop repair semantics.

Non-goals:

- Do not fabricate quality from empty arrays.
- Do not claim verifier acceptance when no verifier result exists.
- Do not allow Routing Memo active behavior from unbacked or heuristic-only
  quality.
- Do not borrow Task Loop checkpoint, blocked, or repair semantics.

Acceptance:

- Unit tests cover null, shadow, and scorecard-backed cases.
- Integration tests prove active Routing Memo authority still requires
  scorecard-backed quality.
- UI/report surfaces display the quality state without overclaiming complete
  quality scoring.

## Implementation Sequence

1. Implement `P0-12` E2E first because it is evidence-only and should not change
   production permission behavior.
2. Implement `P0-13` minimal audit adapter after the E2E establishes the existing
   workspace behavior.
3. Implement `P1-03` shared reference contract before plan editing persists
   additional metadata.
4. Implement `P1-02` lightweight plan edit draft and UI.
5. Implement `P1-04` shadow scorecard producer and quality state wiring.
6. Update product semantics, report matrix, and docs after tests prove each item.

## Verification Plan

Run focused tests during each step, then final gates:

```powershell
pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/workspace-permissions.test.ts tests/unit/role-spawn.test.ts tests/unit/role-orchestration-methods.test.ts --reporter=verbose
pnpm run i18n:lint
pnpm run build:vite
pnpm run typecheck
node scripts/check-capability-claims.mjs --fail-on-warning README.md README.zh-CN.md README.ja-JP.md docs/clawx-product-semantics.md reports/report-authenticity-true-false-positive-matrix-2026-07-04.md
```

Additional E2E specs should include:

- `tests/e2e/chat-plan-mode-write-challenge.spec.ts`
- a plan editing E2E or extension of the existing Task Ledger/roles E2E.
- existing `tests/e2e/role-orchestration-diagnostics.spec.ts` when quality UI or
  orchestration result surfaces change.

## Documentation Updates

Update after implementation evidence exists:

- `shared/product-semantics.ts`
- `docs/clawx-product-semantics.md`
- `reports/report-authenticity-true-false-positive-matrix-2026-07-04.md`
- `README.md`, `README.zh-CN.md`, `README.ja-JP.md` only if user-visible claims
  change.

Each `DONE` row must include:

- changed files.
- verification commands.
- test results.
- real boundary.
- remaining unclaimed capabilities.

## Review Checklist

Before marking any item done:

- The implementation has at least one product path, not only a helper type.
- Tests cover the product path at the right layer.
- The report matrix evidence references current files and commands.
- No text claims full DAG editing, default active Routing Memo learning,
  automatic Task Loop repair, or unified audit beyond wired producers.
- The old `codex/sekb-runtime-knowledge` branch is not used.

