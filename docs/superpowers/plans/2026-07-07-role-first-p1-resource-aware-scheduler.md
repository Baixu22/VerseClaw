# Role-First P1 Resource-Aware Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic resource-aware scheduling and draft-only Agency catalog ingestion without widening into P2-P4 features.

**Architecture:** Add focused runtime modules for scheduling and draft import. The scheduler consumes existing task graph and role contract data, then returns scheduled waves plus metrics. The Agency importer emits inactive draft catalog entries that require explicit validation/promotion before they can ever become active RoleContracts.

**Tech Stack:** TypeScript, OpenClaw runtime modules under `openclaw_runtime/src/agents/**`, Vitest unit tests, existing harness specs, pnpm.

## Global Constraints

- Active phase is P1 only.
- `docs/multi-agent-orchestration-development-plan.md` is the binding global constraint document.
- `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md` is the binding phase constraint.
- `RoleContract` is the only legal runtime role channel.
- Prompt/persona/Agency markdown text must not grant permissions.
- Scheduler may change wave order, concurrency, and skip decisions only; it must not change role tools or permissions.
- Agency imports are draft-only and cannot be spawned.
- Do not implement Complexity Gate, RunbookTemplate, Role Catalog UI, typed blackboard, synthesizer, open mesh A2A, or new long-term memory strategy.
- Follow TDD: write focused failing test, run RED, implement, run GREEN.

---

## File Structure

Create:

- `openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`
  Owns `ResourceAwareWaveScheduler`, scheduler inputs, scheduled wave output, contention logic, role cost summary, and metrics.
- `openclaw_runtime/src/agents/agency-draft-catalog.ts`
  Owns draft catalog entry types, status values, spawn eligibility checks, and promotion validation helpers.
- `openclaw_runtime/src/agents/agency-role-importer.ts`
  Owns draft-only Agency source normalization and importer functions.
- `tests/unit/orchestration-resource-scheduler.test.ts`
  Covers deterministic waves, max active roles, tool contention, dependency preservation, and metrics.
- `tests/unit/agency-role-importer.test.ts`
  Covers draft-only import, invalid fields, tool hints, handoff hints, validation issues, and active promotion guard.

Modify:

- `openclaw_runtime/src/agents/orchestration-protocol.ts`
  Re-export small scheduler types only if existing orchestration callers need one import surface.
- `openclaw_runtime/src/agents/orchestrator-run.ts`
  Use scheduled waves instead of simple waves when scheduler options are provided.
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
  Preserve observed trace behavior and include scheduler metrics in result details or trace attributes.
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
  Accept/forward scheduler options such as max active roles only if the existing tool path already accepts orchestration controls.
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
  Preserve existing response shape while including scheduler metrics if run results expose them.
- `tests/unit/role-orchestration-methods.test.ts`
  Assert existing role-first path still returns P0 result bundle and includes scheduler metrics when enabled.
- `tests/unit/orchestration-protocol-v3.test.ts`
  Keep existing graph/repair behavior green; add scheduler compatibility assertions only if protocol exports change.

## Interfaces

The scheduler module should converge on these names:

```ts
export type ResourceSchedulerOptions = {
  maxActiveRoles?: number;
  exclusiveToolGroups?: readonly (readonly string[])[];
  roleCost?: Partial<Record<string, number>>;
};

export type ScheduledOrchestrationWave = {
  wave: number;
  taskNodeIds: string[];
  roles: string[];
  reason: string;
};

export type SchedulerSkippedNode = {
  taskNodeId: string;
  roleName: string;
  reason: string;
};

export type ResourceSchedulerMetrics = {
  queued: number;
  running: number;
  completed: number;
  skipped: number;
  concurrencyCap: number;
  budgetEstimate: number;
  roleCostSummary: Array<{ roleName: string; taskNodeIds: string[]; estimatedCost: number }>;
};

export type ResourceScheduleResult = {
  waves: ScheduledOrchestrationWave[];
  skipped: SchedulerSkippedNode[];
  metrics: ResourceSchedulerMetrics;
};

export function scheduleResourceAwareWaves(params: {
  graph: OrchestrationTaskGraph;
  roles: readonly RoleContract[];
  options?: ResourceSchedulerOptions;
}): ResourceScheduleResult;
```

The draft catalog modules should converge on these names:

```ts
export type AgencyDraftStatus = "draft" | "reviewed" | "active";

export type AgencyDraftRoleEntry = {
  id: string;
  status: AgencyDraftStatus;
  source: "agency";
  sourceDivision?: string;
  sourceAgentName: string;
  roleName: string;
  displayName: string;
  description?: string;
  capabilityHints: string[];
  toolHints: string[];
  handoffHints: string[];
  roleCandidate?: RoleContract;
  validationIssues: RoleContractValidationIssue[];
};

export function importAgencyDraftRoles(source: unknown): AgencyDraftRoleEntry[];
export function canSpawnAgencyDraft(entry: AgencyDraftRoleEntry): false;
export function validateAgencyDraftPromotion(entry: AgencyDraftRoleEntry): RoleContractValidationResult;
```

### Task 1: Harness And P1 Preflight

**Files:**
- Read: `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md`
- Read: `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`
- Read: `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md`
- Read: `harness/specs/tasks/role-first-p1-resource-aware-scheduler.md`

**Interfaces:**
- Consumes: P1 harness task spec and control pack.
- Produces: command evidence before code changes.

- [ ] **Step 1: Inspect current worktree**

Run:

```powershell
git status --short
```

Expected: output recorded in notes. Unrelated dirty files are not modified.

- [ ] **Step 2: Load harness reading list**

Run:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
```

Expected: command lists P1 task, gateway communication scenario/rules, openclaw runtime layer, and docs control pack.

- [ ] **Step 3: Validate harness spec**

Run:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md --no-diff
```

Expected: PASS.

### Task 2: Resource-Aware Scheduler Core

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`
- Create: `tests/unit/orchestration-resource-scheduler.test.ts`

**Interfaces:**
- Consumes: `OrchestrationTaskGraph`, `OrchestrationTaskNode`, `RoleContract`.
- Produces: `scheduleResourceAwareWaves()`.

- [ ] **Step 1: Write failing deterministic scheduler test**

Create `tests/unit/orchestration-resource-scheduler.test.ts` with a test that imports `scheduleResourceAwareWaves()` and asserts identical inputs return identical `waves` and `metrics`.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts
```

Expected: FAIL because `orchestration-resource-scheduler.ts` does not exist or exports are missing.

- [ ] **Step 3: Implement minimal scheduler**

Create `openclaw_runtime/src/agents/orchestration-resource-scheduler.ts` with the interfaces listed above. Sort ready nodes by original graph order, cap each wave by `maxActiveRoles`, and copy role/task ids into `waves`.

- [ ] **Step 4: Run scheduler test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts
```

Expected: PASS.

### Task 3: Max Active Roles And Tool Contention

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestration-resource-scheduler.ts`
- Modify: `tests/unit/orchestration-resource-scheduler.test.ts`

**Interfaces:**
- Consumes: `ResourceSchedulerOptions.maxActiveRoles`, `RoleContract.tools`, `RoleContract.toolRequirements`.
- Produces: contention-aware scheduled waves.

- [ ] **Step 1: Add failing max active roles test**

Assert a graph with three ready worker nodes and `maxActiveRoles: 2` produces two waves with sizes `2` and `1`.

- [ ] **Step 2: Add failing tool contention test**

Assert two roles that both require `bash` or `write` are split into separate waves even when `maxActiveRoles` would allow both.

- [ ] **Step 3: Run tests to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts
```

Expected: FAIL for missing contention logic.

- [ ] **Step 4: Implement contention grouping**

Add helper logic that computes exclusive tool keys from `role.toolRequirements` and `role.tools`; treat `bash`, `exec`, `write`, `edit`, and `apply_patch` as exclusive by default.

- [ ] **Step 5: Run tests to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts
```

Expected: PASS.

### Task 4: Scheduler Metrics And Orchestration Integration

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestrator-run.ts`
- Modify: `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
- Modify: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- Modify: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- Modify: `tests/unit/role-orchestration-methods.test.ts`

**Interfaces:**
- Consumes: `ResourceScheduleResult`.
- Produces: run result scheduler metrics without changing existing response fields.

- [ ] **Step 1: Add failing run-result assertion**

In `tests/unit/role-orchestration-methods.test.ts`, assert that a scheduled run exposes `schedulerMetrics.concurrencyCap` and still exposes the P0 `resultBundle`.

- [ ] **Step 2: Run focused test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "scheduler"
```

Expected: FAIL because run results do not expose scheduler metrics.

- [ ] **Step 3: Integrate scheduler at run boundary**

Use `scheduleResourceAwareWaves()` where run code currently consumes simple execution waves. Keep existing fields and add scheduler metrics as optional fields.

- [ ] **Step 4: Run focused test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "scheduler"
```

Expected: PASS.

### Task 5: Agency Draft Catalog Types And Importer

**Files:**
- Create: `openclaw_runtime/src/agents/agency-draft-catalog.ts`
- Create: `openclaw_runtime/src/agents/agency-role-importer.ts`
- Create: `tests/unit/agency-role-importer.test.ts`

**Interfaces:**
- Consumes: unknown Agency-like source data.
- Produces: `AgencyDraftRoleEntry[]`.

- [ ] **Step 1: Write failing draft import test**

Create a fixture with one division, one agent, tool hints, and handoff text. Assert `importAgencyDraftRoles()` returns a `draft` entry with `canSpawnAgencyDraft(entry) === false`.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/agency-role-importer.test.ts
```

Expected: FAIL because importer modules do not exist.

- [ ] **Step 3: Implement draft catalog and importer**

Normalize source strings, derive kebab-case `roleName`, preserve tool hints as hints, create a candidate `RoleContract` only for validation, and never return active status by default.

- [ ] **Step 4: Run importer test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/agency-role-importer.test.ts
```

Expected: PASS.

### Task 6: Draft Promotion Guard

**Files:**
- Modify: `openclaw_runtime/src/agents/agency-draft-catalog.ts`
- Modify: `tests/unit/agency-role-importer.test.ts`

**Interfaces:**
- Consumes: `AgencyDraftRoleEntry`.
- Produces: `validateAgencyDraftPromotion()`.

- [ ] **Step 1: Add failing promotion validation tests**

Assert an incomplete draft candidate fails `RoleContract` validation and a complete reviewed candidate can return `ok: true` without automatically becoming active.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/agency-role-importer.test.ts
```

Expected: FAIL for missing promotion validation.

- [ ] **Step 3: Implement promotion guard**

Call `validateRoleContract()` on `entry.roleCandidate` and return validation issues. Do not mutate `entry.status`.

- [ ] **Step 4: Run tests to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/agency-role-importer.test.ts
```

Expected: PASS.

### Task 7: Phase Gate Suite And Documentation Sync Check

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

**Interfaces:**
- Consumes: all P1 changed files.
- Produces: final verification evidence.

- [ ] **Step 1: Run P1 unit suite**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/agency-role-importer.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run harness validation**

Run:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
```

Expected: PASS.

- [ ] **Step 3: Run comms checks**

Run:

```powershell
pnpm run comms:replay
pnpm run comms:compare
```

Expected: PASS if runtime/tool/gateway communication paths changed.

- [ ] **Step 4: Review README sync**

Run:

```powershell
git diff -- README.md README.zh-CN.md README.ja-JP.md
```

Expected: no diff unless public user behavior changed. If user-visible behavior changed, update all required README files.

- [ ] **Step 5: Final non-goal grep**

Run:

```powershell
rg -n "ComplexityGate|RunbookTemplate|OrchestrationBlackboard|Synthesizer|Role Catalog" openclaw_runtime src tests docs/multi-agent-orchestration docs/superpowers
```

Expected: Matches only docs/tests explaining non-goals, not production implementations for P2-P4.

## Self-Review Checklist

- P1 scheduler is deterministic.
- P1 scheduler respects dependencies and max active roles.
- P1 scheduler does not grant permissions.
- Agency importer emits draft-only entries.
- Draft entries cannot spawn.
- Draft promotion requires RoleContract validation.
- Existing P0 tests remain green.
- Final report includes exact command results from the current run.
