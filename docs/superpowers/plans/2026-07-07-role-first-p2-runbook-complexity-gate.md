# Role-First P2 RunbookTemplate And Complexity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured complexity entry gate and reusable runbook templates without widening into P3-P4 features.

**Architecture:** Add focused runtime modules for classification, runbook validation, runbook registry, and runbook-to-task-graph conversion. The gate and runbooks produce structured planning data only; existing RoleContract, scheduler, result bundle, schema gate, verifier gate, and max-one repair boundaries remain authoritative.

**Tech Stack:** TypeScript, OpenClaw runtime modules under `openclaw_runtime/src/agents/**`, Vitest unit tests, existing harness specs, pnpm.

## Global Constraints

- Active phase is P2 only.
- `docs/multi-agent-orchestration-development-plan.md` is the binding global constraint document.
- `docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md` is the binding phase constraint.
- `RoleContract` is the only legal runtime role channel.
- Prompt/persona/Agency markdown/runbook prose must not grant permissions.
- ComplexityGate may recommend orchestration mode only; it must not grant tools, roles, permissions, or memory writes.
- RunbookTemplate is structured planning data, not a long prompt.
- Runbook-generated graphs must still pass through `ResourceAwareWaveScheduler`, `SchemaComplianceGate`, `VerifierGate`, and max-one repair handling.
- Do not implement typed blackboard, synthesizer, Role Catalog UI, open mesh A2A, or new long-term memory strategy.
- Follow TDD: write focused failing test, run RED, implement, run GREEN.

---

## File Structure

Create:

- `openclaw_runtime/src/agents/complexity-gate.ts`
  Owns `ComplexityGateDecision`, input signals, mode classification, confidence, and reason codes.
- `openclaw_runtime/src/agents/runbook-template.ts`
  Owns `RunbookTemplate`, validation result types, and `validateRunbookTemplate()`.
- `openclaw_runtime/src/agents/runbook-registry.ts`
  Owns built-in runbook fixture registry and selection helpers.
- `openclaw_runtime/src/agents/runbook-task-graph.ts`
  Owns conversion from a selected runbook to existing task graph types.
- `tests/unit/complexity-gate.test.ts`
  Covers classification table, explicit user team selection, and reason data.
- `tests/unit/runbook-template.test.ts`
  Covers schema validation, built-in fixtures, unsafe permission/prose fields, and dependency validation.
- `tests/unit/runbook-task-graph.test.ts`
  Covers runbook-to-task-graph output and scheduler/verifier boundary preservation.

Modify only if needed:

- `openclaw_runtime/src/agents/orchestrator.ts`
  Accept complexity/runbook decision data without bypassing existing role router/template paths.
- `openclaw_runtime/src/agents/orchestration-protocol.ts`
  Reuse existing task graph types; add only narrow metadata if required by tests.
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
  Expose decision/runbook metadata only when the existing tool path already returns orchestration details.
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
  Preserve existing response shape while adding decision/runbook metadata if run results expose it.

## Interfaces

The complexity gate module should converge on these names:

```ts
export type ComplexityGateMode =
  | "single-agent"
  | "role-routed"
  | "team-orchestrated"
  | "runbook-orchestrated";

export type ComplexityGateInput = {
  task: string;
  fileHints?: readonly string[];
  explicitTeamRequested?: boolean;
  explicitRunbookId?: string;
  riskHints?: readonly string[];
  capabilityHints?: readonly string[];
  toolHints?: readonly string[];
  priorFailureCount?: number;
};

export type ComplexityGateDecision = {
  mode: ComplexityGateMode;
  confidence: number;
  selectedRunbookId?: string;
  signals: Array<{ name: string; value: string | number | boolean }>;
  reasons: string[];
  warnings: string[];
};

export function classifyComplexity(input: ComplexityGateInput): ComplexityGateDecision;
```

The runbook modules should converge on these names:

```ts
export type RunbookTemplate = {
  id: string;
  version: string;
  title: string;
  intent: string[];
  requiredRoles: string[];
  optionalRoles: string[];
  graph: {
    nodes: Array<{
      id: string;
      roleName: string;
      task: string;
      dependsOn?: string[];
      verifier?: boolean;
    }>;
  };
  verification: {
    verifierRole: string;
    expectedEvidence: string[];
  };
  handoff: {
    rules: string[];
  };
};

export type RunbookValidationIssue = {
  path: string;
  message: string;
};

export type RunbookValidationResult = {
  ok: boolean;
  issues: RunbookValidationIssue[];
};

export function validateRunbookTemplate(
  template: RunbookTemplate,
  knownRoleNames: readonly string[],
): RunbookValidationResult;
```

## Task 1: Harness And P2 Preflight

**Files:**
- Read: `docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md`
- Read: `docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md`
- Read: `docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md`
- Read: `harness/specs/tasks/role-first-p2-runbook-complexity-gate.md`

**Interfaces:**
- Consumes: P2 harness task spec and control pack.
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
pnpm harness context --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
```

Expected: command lists P2 task, gateway communication scenario/rules, openclaw runtime layer, and docs control pack.

- [ ] **Step 3: Validate harness spec**

Run:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md --no-diff
```

Expected: PASS.

## Task 2: ComplexityGate Classification

**Files:**
- Create: `openclaw_runtime/src/agents/complexity-gate.ts`
- Create: `tests/unit/complexity-gate.test.ts`

**Interfaces:**
- Consumes: `ComplexityGateInput`.
- Produces: `classifyComplexity()`.

- [ ] **Step 1: Write failing classification table tests**

Create `tests/unit/complexity-gate.test.ts` with table cases:

```ts
import { describe, expect, it } from 'vitest';
import { classifyComplexity } from '../../openclaw_runtime/src/agents/complexity-gate';

describe('ComplexityGate', () => {
  it.each([
    [{ task: 'rename this variable' }, 'single-agent'],
    [{ task: 'review auth and payment changes', fileHints: ['auth.ts', 'billing.ts'], riskHints: ['security'] }, 'team-orchestrated'],
    [{ task: 'fix failing test suite after repeated failures', priorFailureCount: 2, capabilityHints: ['testing', 'implementation'] }, 'runbook-orchestrated'],
    [{ task: 'explain this function', explicitTeamRequested: true }, 'team-orchestrated'],
  ] as const)('classifies %#', (input, mode) => {
    const decision = classifyComplexity(input);
    expect(decision.mode).toBe(mode);
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.confidence).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/complexity-gate.test.ts
```

Expected: FAIL because `complexity-gate.ts` does not exist.

- [ ] **Step 3: Implement minimal gate**

Create `openclaw_runtime/src/agents/complexity-gate.ts` with the interfaces above. Use deterministic signal scoring:

- explicit runbook id -> `runbook-orchestrated`,
- explicit team requested -> `team-orchestrated`,
- prior failure count >= 2 -> `runbook-orchestrated`,
- risk hints or file hint count >= 2 plus multiple capabilities -> `team-orchestrated`,
- otherwise `single-agent`.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/complexity-gate.test.ts
```

Expected: PASS.

## Task 3: RunbookTemplate Validation

**Files:**
- Create: `openclaw_runtime/src/agents/runbook-template.ts`
- Create: `tests/unit/runbook-template.test.ts`

**Interfaces:**
- Consumes: `RunbookTemplate`, known role names.
- Produces: `validateRunbookTemplate()`.

- [ ] **Step 1: Write failing validation tests**

Create tests that assert:

- a valid runbook passes,
- unknown role name fails,
- duplicate graph node ids fail,
- dependency on unknown node id fails,
- empty `expectedEvidence` fails,
- fields named `tools`, `permissions`, or `prompt` on graph nodes fail.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/runbook-template.test.ts
```

Expected: FAIL because `runbook-template.ts` does not exist.

- [ ] **Step 3: Implement validation**

Create `openclaw_runtime/src/agents/runbook-template.ts` with strict validation over the fields above. Reject unsafe extra fields by checking each raw node record for `tools`, `permissions`, or `prompt`.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/runbook-template.test.ts
```

Expected: PASS.

## Task 4: Built-In Runbook Registry

**Files:**
- Create: `openclaw_runtime/src/agents/runbook-registry.ts`
- Modify: `tests/unit/runbook-template.test.ts`

**Interfaces:**
- Consumes: `RunbookTemplate`, `validateRunbookTemplate()`.
- Produces: `BUILT_IN_RUNBOOK_TEMPLATES`, `listRunbookTemplates()`, `selectRunbookCandidates()`.

- [ ] **Step 1: Add failing built-in fixture tests**

Assert at least five built-in runbooks exist and each validates against built-in role names:

- code-review,
- feature-implementation,
- security-check,
- documentation-migration,
- test-repair.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/runbook-template.test.ts
```

Expected: FAIL because registry exports do not exist.

- [ ] **Step 3: Implement registry fixtures**

Create `runbook-registry.ts` with the five templates. Each template must reference existing built-in roles only and include non-empty expected evidence.

- [ ] **Step 4: Run tests to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/runbook-template.test.ts
```

Expected: PASS.

## Task 5: Runbook To Task Graph

**Files:**
- Create: `openclaw_runtime/src/agents/runbook-task-graph.ts`
- Create: `tests/unit/runbook-task-graph.test.ts`

**Interfaces:**
- Consumes: selected `RunbookTemplate`, original task, known role names.
- Produces: existing `OrchestrationTaskGraph`.

- [ ] **Step 1: Write failing conversion tests**

Assert a selected runbook:

- creates graph nodes with stable ids,
- references existing role names only,
- preserves dependencies,
- includes a verifier node or verification policy boundary,
- can be scheduled by `scheduleResourceAwareWaves()`.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/runbook-task-graph.test.ts
```

Expected: FAIL because conversion module does not exist.

- [ ] **Step 3: Implement conversion**

Create `runbook-task-graph.ts`. Build an `OrchestrationTaskGraph` using existing protocol node shape. Do not spawn workers and do not grant permissions.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/runbook-task-graph.test.ts
```

Expected: PASS.

## Task 6: Orchestration Integration Metadata

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestrator.ts`
- Modify: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- Modify: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- Modify: `tests/unit/role-orchestration-methods.test.ts`

**Interfaces:**
- Consumes: `ComplexityGateDecision`, selected runbook metadata.
- Produces: response fields without removing P0/P1 fields.

- [ ] **Step 1: Add failing response metadata tests**

In `tests/unit/role-orchestration-methods.test.ts`, assert plan/run/tool details can include:

- `complexityDecision`,
- `runbookSelection`,
- `schedulerMetrics`,
- `resultBundle`.

- [ ] **Step 2: Run focused test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "complexityDecision|runbookSelection"
```

Expected: FAIL because P2 metadata is not exposed.

- [ ] **Step 3: Integrate metadata only**

Thread gate/runbook metadata through planning responses. Do not change role permissions, worker prompts, or scheduler enforcement.

- [ ] **Step 4: Run focused test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "complexityDecision|runbookSelection"
```

Expected: PASS.

## Task 7: Phase Gate Suite And Documentation Sync Check

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

**Interfaces:**
- Consumes: all P2 changed files.
- Produces: final verification evidence.

- [ ] **Step 1: Run P2 unit suite**

Run:

```powershell
pnpm exec vitest run tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run P0/P1 regression suite**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run harness validation**

Run:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
```

Expected: PASS.

- [ ] **Step 4: Run comms checks**

Run:

```powershell
pnpm run comms:replay
pnpm run comms:compare
```

Expected: PASS if runtime/tool/gateway communication paths changed.

- [ ] **Step 5: Review README sync**

Run:

```powershell
git diff -- README.md README.zh-CN.md README.ja-JP.md
```

Expected: no diff unless public user behavior changed. If user-visible behavior changed, update all required README files.

- [ ] **Step 6: Final non-goal grep**

Run:

```powershell
rg -n "OrchestrationBlackboard|Synthesizer|Role Catalog|direct worker-to-worker|Agency markdown runtime" openclaw_runtime src tests docs/multi-agent-orchestration docs/superpowers
```

Expected: Matches only docs/tests explaining non-goals, not production implementations for P3-P4.

## Self-Review Checklist

- ComplexityGate is deterministic and explainable.
- Simple tasks default away from multi-agent orchestration.
- Explicit user team selection is not blocked.
- Runbook templates are structured data, not prompts.
- Runbook graphs reference existing RoleContract names only.
- Runbook graphs still flow through P1 scheduler and P0 gates.
- Runbook prose cannot grant permissions.
- Existing P0/P1 tests remain green.
- Final report includes exact command results from the current run.
