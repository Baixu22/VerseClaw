# Role-First P4 Synthesizer And Local Dynamic DAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P4 read-only synthesis, bounded local dynamic DAG refinement, and a narrow UI result view.

**Architecture:** Add two focused runtime modules, expose synthesis through existing orchestration result payloads, and render synthesis in the existing Roles Orchestration panel. Dynamic DAG refinement remains a pure helper that validates proposals and reruns the P1 scheduler.

**Tech Stack:** TypeScript, Vitest, React 19, Vite/Electron, Playwright.

## Global Constraints

- Use `corepack pnpm` so the repository-pinned `pnpm@10.33.4` is used.
- `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md` is the binding phase constraint.
- Renderer uses `hostApi.gateway.rpc`; do not add raw IPC or direct Gateway HTTP calls.
- New visible UI text must be routed through `react-i18next` with en/zh/ja/ru locale coverage.
- UI changes require Electron E2E coverage.
- No synthesizer tool access, verifier override, scheduler bypass, memory persistence, open A2A, or Agency runtime activation.

---

### Task 1: P4 Control Pack

**Files:**
- Create: `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md`
- Create: `docs/multi-agent-orchestration/goal-mode-start-prompt-p4.md`
- Create: `docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md`
- Create: `harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md`
- Modify: `docs/multi-agent-orchestration/README.md`
- Modify: `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`

**Interfaces:**
- Produces the P4 spec entry used by `corepack pnpm harness context --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md`.

- [ ] **Step 1: Validate the P4 harness spec shape**

Run: `corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --no-diff`

Expected: PASS.

### Task 2: Orchestration Synthesizer

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-synthesizer.ts`
- Create: `tests/unit/orchestration-synthesizer.test.ts`

**Interfaces:**
- Produces `synthesizeOrchestrationResult(input: SynthesizeOrchestrationInput): OrchestrationSynthesis`.
- Consumes `OrchestrationResultBundle` and optional `BlackboardSynthesisSummary`.

- [ ] **Step 1: Write failing tests**

Cover stable output, role contribution preservation, verifier fail preservation, blackboard summary preservation, and `policy.toolAccess === "none"`.

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/orchestration-synthesizer.test.ts`

Expected: FAIL because `orchestration-synthesizer.ts` does not exist.

- [ ] **Step 3: Implement minimal synthesizer**

Add deterministic status derivation, evidence copying, role contribution projection, visible failures, artifact refs, trace ids, blackboard summary, and policy metadata.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/orchestration-synthesizer.test.ts`

Expected: PASS.

### Task 3: Local Dynamic DAG Refinement

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-dynamic-dag.ts`
- Create: `tests/unit/orchestration-dynamic-dag.test.ts`

**Interfaces:**
- Produces `refineLocalDynamicDag(input: LocalDynamicDagRefinementInput): LocalDynamicDagRefinementResult`.
- Consumes `OrchestrationTaskGraph`, `RoleContract[]`, and P1 scheduler options.

- [ ] **Step 1: Write failing tests**

Cover valid scoped node creation, source/reason/scope/attempt metadata, unknown role rejection, unknown dependency rejection, unsafe authority-field rejection, out-of-scope capability rejection, and scheduler cap preservation.

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/orchestration-dynamic-dag.test.ts`

Expected: FAIL because `orchestration-dynamic-dag.ts` does not exist.

- [ ] **Step 3: Implement minimal dynamic DAG helper**

Validate proposals, add nodes without mutating existing graph, add follow-up/dependency edges, call `scheduleResourceAwareWaves`, and return issues without throwing for ordinary invalid proposals.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/orchestration-dynamic-dag.test.ts`

Expected: PASS.

### Task 4: Gateway And Tool Projection

**Files:**
- Modify: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- Modify: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- Modify: `tests/unit/role-orchestration-methods.test.ts`

**Interfaces:**
- `orchestrator.run` payload includes `synthesis`.
- `team_orchestrate` details include `synthesis`.

- [ ] **Step 1: Write failing gateway/tool tests**

Assert result payloads include synthesis and retain existing `resultBundle`, `schedulerMetrics`, `complexityDecision`, and `runbookSelection`.

- [ ] **Step 2: Run tests to verify RED**

Run: `corepack pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "synthesis"`

Expected: FAIL because payloads do not include synthesis.

- [ ] **Step 3: Add synthesis projection**

Call `synthesizeOrchestrationResult({ bundle: result.resultBundle })` after orchestration result creation. Do not change run execution, permissions, scheduler, verifier, or blackboard behavior.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "synthesis|P2 metadata|scheduler metrics"`

Expected: PASS.

### Task 5: UI Result View

**Files:**
- Modify: `src/components/agents/RolesOrchestrationPanel.tsx`
- Modify: `shared/i18n/locales/en/agents.json`
- Modify: `shared/i18n/locales/zh/agents.json`
- Modify: `shared/i18n/locales/ja/agents.json`
- Modify: `shared/i18n/locales/ru/agents.json`
- Create: `tests/e2e/role-orchestration-synthesis.spec.ts`

**Interfaces:**
- Renderer stores `synthesis` from `orchestrator.run`.
- UI renders `data-testid="role-orchestration-synthesis"`.

- [ ] **Step 1: Write failing E2E**

Mock `orchestrator.run` to return synthesis, click Run, and assert summary, verifier decision, evidence count, and visible failure text.

- [ ] **Step 2: Run E2E to verify RED**

Run: `corepack pnpm run test:e2e tests/e2e/role-orchestration-synthesis.spec.ts`

Expected: FAIL because the UI result view does not exist.

- [ ] **Step 3: Implement UI view and locale strings**

Add a compact two-column synthesis view below run result. Use existing design tokens and localized strings.

- [ ] **Step 4: Run E2E to verify GREEN**

Run: `corepack pnpm run test:e2e tests/e2e/role-orchestration-synthesis.spec.ts`

Expected: PASS.

### Task 6: Final Verification

**Files:**
- No new files.

**Interfaces:**
- Proves P4 did not regress P0-P3.

- [ ] **Step 1: Run P4 unit tests**

Run: `corepack pnpm exec vitest run tests/unit/orchestration-synthesizer.test.ts tests/unit/orchestration-dynamic-dag.test.ts tests/unit/role-orchestration-methods.test.ts`

Expected: PASS.

- [ ] **Step 2: Run P0-P3 regression suites**

Run: `corepack pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-blackboard-trace.test.ts tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts`

Expected: PASS.

- [ ] **Step 3: Run harness and comms**

Run:

```powershell
corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --since e57db91db
corepack pnpm run comms:replay
corepack pnpm run comms:compare
```

Expected: PASS.

- [ ] **Step 4: Run non-goal grep**

Run: `rg -n "toolAccess: \"allowed\"|memory persistence|direct worker-to-worker|open mesh A2A|Agency markdown runtime" openclaw_runtime src tests docs/multi-agent-orchestration docs/superpowers`

Expected: no production implementation of forbidden P4 non-goals.
