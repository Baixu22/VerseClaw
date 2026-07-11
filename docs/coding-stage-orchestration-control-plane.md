# Coding Stage Orchestration Control Plane

## Status and Scope

This document is the durable operating guide for agents that coordinate the coding-runtime roadmap. It defines orchestration responsibilities, stage boundaries, completion evidence, and low-frequency scheduling. It does not authorize a scheduler to modify product code, weaken a gate, or replace the authoritative design/task specifications for any stage.

The roadmap is intentionally sequential:

```text
DCS P1 working_memory foundation
  -> Coding Runtime P0 workspace authority + mutation producer
  -> CodeGraph P0 on-demand + freshness/provenance
  -> DCS P2 task_state + handoff
  -> AgentMap shadow A/B
  -> AST structured modification pilot
```

The scheduler is a control plane, not a runtime feature, context engine, event bus, task ledger, or source of product truth.

## Authority Hierarchy

For each stage, authority is resolved in this order:

1. User instructions and applicable `AGENTS.md` files.
2. The stage's approved architecture/design specification.
3. The stage's Harness task specification, rules, scenarios, and layer conventions.
4. The implementation task's immutable start package.
5. The independent acceptance report and machine-readable stage report.
6. This document's orchestration rules.

This document must never be used to reinterpret a design choice, expand `touchedAreas`, or mark work complete when the stage specification says otherwise.

## Roles and Isolation

Each stage uses separate visible Codex tasks. Do not continue a later phase in the previous implementation task.

| Role | May do | Must not do |
| --- | --- | --- |
| Orchestrator | Read reports, create a new task, set task metadata, record state transitions, pause duplicate work | Edit product code, run implementation gates as proof, self-certify a stage, infer completion from prose or README markers |
| Implementation task | Change only the stage-owned scope, run required gates, write an implementation report | Approve its own work or create the next stage |
| Acceptance task | Independently inspect diff/spec/evidence and rerun an appropriate verification subset | Change product code or downgrade a hard gate |
| Remediation task | Fix only acceptance findings, then return to a new acceptance task | Reuse a stale acceptance pass or expand scope without a spec update |
| Operator | Pause, resume, approve explicit high-risk pilots, resolve environment/worktree ambiguity | Bypass a failed gate without recording an approved exception |

Required task naming:

```text
[S01] DCS P1 Implementation
[S01] DCS P1 Acceptance
[S01] DCS P1 Remediation 01
[S02] Coding Runtime P0 Implementation
```

An acceptance failure always creates a new remediation task and a fresh acceptance task. It never turns the acceptance task into the fixer.

## Stage State Machine

```text
planned
  -> implementation_active
  -> implementation_candidate
  -> acceptance_active
  -> complete

implementation_active -> blocked
implementation_candidate -> remediation_required
acceptance_active -> remediation_required | blocked
remediation_required -> implementation_active
blocked -> implementation_active | cancelled
```

`complete` is terminal for a stage. The next stage may be created only from a verified `complete` report. `blocked` is not a failure of the scheduler; it means an external condition, ambiguous worktree state, or explicit operator decision prevents proof of completion.

## Required Stage Report

Every acceptance task writes a machine-readable report before the orchestrator can advance. Its storage location is chosen by the future implementation, but it must be checked in or otherwise durably addressable from the report.

```ts
type GateResult = {
  command: string;
  exitCode: number;
  evidencePath?: string;
  ranAt: string;
};

type StageReport = {
  schemaVersion: 1;
  stageId: string;
  status: COMPLETE | BLOCKED | FAILED;
  implementationTaskId: string;
  acceptanceTaskId: string;
  stageSpecPath: string;
  predecessorReportFingerprint?: string;
  diffFingerprint: string;
  gates: GateResult[];
  review: {
    critical: number;
    important: number;
    reportPath: string;
  };
  invariants: Record<string, boolean | number | string>;
  productionCoverage: Record<string, number | string>;
  limitations: string[];
  nextStageEligibility: eligible | ineligible;
};
```

The orchestrator advances only when all of the following are true:

1. `status` is `COMPLETE`.
2. Every required stage gate is listed and has `exitCode: 0`.
3. `review.critical` and `review.important` are both `0`.
4. Every stage-specific invariant is present and true.
5. `nextStageEligibility` is `eligible`.
6. `diffFingerprint` and `predecessorReportFingerprint` match the inputs that the acceptance task inspected.
7. No active next-stage implementation task already exists for the same predecessor fingerprint.

Partial test success, a README label, a green subset, an implementation task's claim, and an old report are never completion evidence.

## Common Gate Policy

Each task spec declares its exact command set. At minimum, a stage report must distinguish:

| Gate class | Meaning | Advancement rule |
| --- | --- | --- |
| Functional | Unit/integration/E2E behavior required by the stage | Must pass |
| Boundary | Harness, contract, ownership, security, transport, scope scans | Must pass |
| Regression | Typecheck, lint, focused/full tests, comms replay/compare when applicable | Must pass |
| Build/package | Required retained runtime or app builds | Must pass unless the authoritative stage spec removes the capability before implementation |
| Environmental | A proven external/worktree/tooling condition that prevents a required gate | Mark `BLOCKED`; do not convert to `COMPLETE` |

An environmental failure requires an evidence path, the affected command, an explanation of why it is outside the stage-owned diff, and an operator/remediation route. It is not a waiver.

## Roadmap Contracts

### S01: DCS P1 - Working Memory Foundation

**Authority:** `team/dcs/dcs-v1.6-spec.md` and `harness/specs/tasks/dcs-stage1-working-memory-handler.md`.

**Owns:** explicit `details.working_memory` envelope normalization, rolling working-memory handling, BlockStore admission/persistence boundary, temporary `## Recent Actions` projection, default-off configuration, and required retained runtime build repairs.

**Must prove:**

- `## Recent Actions` is a per-LLM-call temporary context transform, never transcript persistence or accumulating history.
- Missing, malformed, or low-significance working-memory metadata causes zero inference, zero BlockStore write, and zero injection.
- The report states real production producer coverage; if no real producer exists, it reports `coverage = 0` and does not claim coding uplift from synthetic tests.
- COMPASS, task_state, handoff, knowledge, notes, Renderer/Main/Gateway transport, and direct IPC/HTTP remain outside the stage.

**Unlocks:** S02 only.

### S02: Coding Runtime P0 - Workspace Authority + Mutation Producer

**Owns:** trusted `workspaceId -> Main resolved rootPath` propagation; single-run agreement among `workspaceDir`, `cwd`, file-tool boundary, and sandbox root; session-workspace binding; and producer-owned envelopes from `edit`, `write`, and `apply_patch` only.

**Must prove:**

- Renderer supplies identity only; Main resolves executable paths through existing boundaries.
- Workspace A cannot read or reuse workspace B's working-memory scope.
- `edit`, `write`, and `apply_patch` produce explicit structured envelopes only when the producer has the required structured outcome. `read`, search, CodeGraph, and generic exec/process do not produce one.
- Flag-off and no-envelope paths have reference/byte-level no-op behavior, including zero BlockStore construction/query/write.
- The next LLM call observes exactly one Recent Actions projection without repetition.

**Unlocks:** S03 and, after S03 is complete, S04.

### S03: CodeGraph P0 - On-Demand + Freshness/Provenance

**Owns:** demand-triggered CodeGraph use, workspace scoping, freshness checks, and provenance records for results used by coding flows.

**Must prove:**

- No always-on index/ranking promotion or automatic prompt injection.
- Query results include workspace identity, source/revision or content fingerprint, generated-at time, and stale/unknown status.
- Stale, missing-provenance, or cross-workspace results cannot serve as hard claims or mutation authority.
- On-demand execution has measured latency/token behavior, but measurements are not presented as benefit without a controlled comparison.

**Unlocks:** S04 and supplies evidence inputs to S05.

### S04: DCS P2 - Task State + Handoff

**Owns:** task-state lifecycle producer, DCS task_state block updates, handoff package storage/recovery, and session/workspace isolation.

**Must prove:**

- A new or resumed session restores only its own workspace-scoped task_state.
- Handoff uses durable structured state and evidence references, not a transcript copy or prompt-string data channel.
- Parent/child authorization is explicit and no silent cross-workspace/session reuse occurs.
- The existing preview-first chat handoff boundary remains respected; see `harness/specs/tasks/chat-session-handoff-mvp.md`.

**Unlocks:** S05.

### S05: AgentMap - Shadow A/B

**Owns:** diagnostic-only candidate generation/selection comparison under fixed task, workspace, model, and budget conditions.

**Must prove:**

- Default behavior remains unchanged; the experiment is shadow-only.
- Baseline and candidate consume equivalent, provenance-valid inputs.
- Reports capture task outcomes, grounding/provenance, latency, token/cost, fallbacks, and disagreement reasons.
- No cutover claim is made from one-off anecdotes, raw injection volume, or usage counters.

**Unlocks:** S06 only after an explicit operator decision that shadow evidence is sufficient.

### S06: AST - Structured Modification Pilot

**Owns:** explicit, user-approved structured modifications to caller-owned targets, with fingerprint rechecks and fail-closed scope control.

**Must prove:**

- No default-on behavior, background mutation, TaskLoop/Gateway/Renderer route expansion, or completion-evidence conflation.
- Target fingerprints and operator-approved scope are rechecked immediately before application.
- Scope drift, invalid gate readiness, or missing approval fails closed.
- The pilot follows the existing controlled-apply posture in `harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md`.

**Unlocks:** no automatic next stage. Any promotion requires a new operator-approved roadmap decision.

## Scheduling Policy

Use event-first scheduling. Timers are safety nets, not the normal mechanism for advancing a stage.

| Scheduler | Trigger | Fallback interval | Allowed action |
| --- | --- | ---: | --- |
| Stage monitor | Task status or report fingerprint changes | 6 hours while implementation is active | Read state and record a transition; never create a successor from commentary |
| Acceptance dispatcher | Stable implementation candidate report | 30-minute debounce | Create one fresh acceptance task if no equivalent acceptance task exists |
| Blocked-state monitor | A report records `BLOCKED` | 12 hours | Recheck only the named external condition; notify the operator only on state change or after 24 hours |
| Orchestration reconciler | Missing event, interrupted task, or staged report | 12 hours | Repair control-plane metadata or create a missing acceptance task; never edit product code |
| Daily evidence sweeper | Scheduled | 24 hours | Compare report/spec/diff fingerprints and mark stale reports ineligible |

Do not poll more frequently merely because a task is active. A task that has not published a status or report fingerprint change is left alone until the next fallback interval.

## Idempotency and New-Task Creation

Before creating any task, the orchestrator calculates:

```text
orchestrationKey = stageId + predecessorReportFingerprint + taskRole
```

It must persist this key with the created task identifier. A matching active, completed, or blocked task is reused/read before another is created. The orchestrator must not create a second implementation, acceptance, or remediation task for the same key.

Every newly created task receives an immutable start package containing:

1. Stage ID and role (`implementation`, `acceptance`, or `remediation`).
2. The exact task-spec path and authoritative design inputs.
3. Predecessor `StageReport` path and fingerprint.
4. Explicit allowed and forbidden paths/behaviors.
5. Required gates and the expected final report schema.
6. Known limitations and blocked conditions inherited from the predecessor.
7. A statement that it must not create the next stage.

The orchestrator may create a visible new Codex task/window. It must not silently redirect an old implementation task into a different stage.

## Operator Controls

The control plane needs explicit manual controls before it is implemented:

- `pause-stage <stageId>`: stop dispatching new work; preserve evidence.
- `resume-stage <stageId>`: re-run only reconciliation and blocked-state checks.
- `invalidate-report <reportFingerprint>`: mark a stale or incorrectly scoped report ineligible.
- `approve-pilot <stageId> <scopeFingerprint>`: required only for explicitly gated experiments such as S06.
- `cancel-stage <stageId>`: terminal operator decision; no successor is created.

None of these commands may transform a failed or blocked gate into a successful one.

## Future Implementation Boundary

Future automation may store orchestration metadata under a dedicated artifact/control-plane location, but it must not introduce a parallel durable product state. The implementation should first create its own Harness task spec and prove:

- all state transitions are replayable from reports and task metadata;
- duplicate events do not duplicate tasks;
- scheduler restarts retain idempotency;
- stale reports cannot advance a stage;
- a blocked build/environmental gate cannot be auto-waived;
- no scheduler path can edit source code, invoke direct Renderer/Gateway transport, or change feature flags;
- every new task starts in a distinct visible window with an immutable input package.

Until that implementation task is explicitly approved, this document is a design and handoff artifact only. It creates no timer, thread, hook, feature flag, or runtime behavior.
