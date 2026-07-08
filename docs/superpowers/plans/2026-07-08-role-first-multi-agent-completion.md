# Role-First Multi-Agent Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining delivery gaps for role-first + bounded multi-agent orchestration so the implementation can pass real capability acceptance, not just semantic/code-presence checks.

**Architecture:** Keep `RoleContract` as the only runtime role channel. Agency Agents remain draft-only catalog/runbook source material. P3 blackboard becomes a runtime-owned typed state projection with trace-replayable events and verifier-readable evidence; P4 synthesis/UI consumes only verified bundle, trace, artifact refs, verifier report, and blackboard summary.

**Tech Stack:** Electron + React 19 + Vite + TypeScript, OpenClaw runtime TypeScript, Vitest, Playwright Electron E2E, pnpm.

## Global Constraints

- `RoleContract` is the only legal runtime role channel; Agency markdown/persona/prompt templates must not become runtime spawn subjects.
- Agency tools are candidate hints only; importing Agency content must not grant real tools.
- Runtime, not UI or prompt text, must enforce max active roles and max-one repair.
- Blackboard entries must be typed, append-only or versioned update; conflicts must not be silently overwritten.
- Blackboard must not grant new tools, prompts, permissions, or memory writes.
- Synthesizer must have no tool permission and must only consume controlled bundle/trace/artifact/verifier/blackboard projections.
- UI must not hide failures; failure, rejection, and repair state must remain visible.
- New user-facing UI text must be routed through `react-i18next` with `en` / `zh` / `ja` / `ru` coverage.
- Renderer must call runtime through `hostApi.gateway.rpc`; no direct Gateway HTTP or raw IPC calls in components.
- Before claiming delivery, run fresh verification and report exact command output.

---

## Current Known State

The working tree already contains partial implementation for:

- Real Agency repository import from `C:/Users/27933/Desktop/verseshell/agency-agents-main`.
- Runtime-derived `blackboardState` / `blackboardSummary` in `runOrchestrationObserved`.
- `blackboardSummary` passed into gateway/tool synthesis.
- P4 synthesis UI expanded into a dual-column card.
- E2E expanded toward success/failure/repair-required/repair-after-success paths.

The last round could not complete verification because `pnpm run typecheck` triggered `node_modules` recreation and the then-active network sandbox prevented dependency restoration. This plan begins with dependency recovery and fresh red/green verification.

## File Map

- Modify: `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
  - Own runtime blackboard projection, blackboard trace events, and result payload fields.
- Modify/Create: `openclaw_runtime/src/agents/orchestration-runtime-blackboard.ts`
  - Extract blackboard projection helpers from `orchestrator-run-observed.ts` if the helper remains larger than ~80 lines.
- Modify: `openclaw_runtime/src/agents/orchestration-blackboard-trace.ts`
  - Add runtime event conversion/replay assertions for actual orchestration blackboard events.
- Modify: `openclaw_runtime/src/agents/orchestration-synthesizer.ts`
  - Preserve blackboard summary and verifier references without granting tools/memory.
- Modify: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
  - Return blackboard state/summary and synthesize from runtime summary.
- Modify: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
  - Return blackboard state/summary and mark bounded A2A enabled only when blackboard projection is present.
- Modify: `openclaw_runtime/src/agents/agency-draft-catalog.ts`
  - Add a promotion review record helper/API shape if no existing gateway method covers Agency draft promotion.
- Modify: `openclaw_runtime/src/agents/agency-role-importer.ts`
  - Keep real local Agency import and draft-only boundaries.
- Modify: `src/components/agents/RolesOrchestrationPanel.tsx`
  - Complete dual-column result details and ensure no hardcoded new text remains.
- Modify: `shared/i18n/locales/{en,zh,ja,ru}/agents.json`
  - Maintain locale coverage for synthesis/blackboard labels.
- Modify: `tests/unit/role-orchestration-methods.test.ts`
  - Runtime blackboard, gateway/tool payload, bounded A2A policy tests.
- Modify/Create: `tests/unit/orchestration-runtime-blackboard.test.ts`
  - Focused tests for blackboard projection from bundle/outcomes/failures.
- Modify: `tests/unit/orchestration-blackboard-trace.test.ts`
  - Trace replay from real runtime blackboard events.
- Modify: `tests/unit/agency-role-importer.test.ts`
  - Real repo import, draft-only, promotion validation, no runtime tool grant.
- Modify: `tests/e2e/role-orchestration-synthesis.spec.ts`
  - Success, failure, repair-required, repair-after-success UI coverage.

---

## Task 1: Restore Verification Environment Without Changing Lockfile

**Files:**
- Read: `package.json`
- Read: `pnpm-lock.yaml`
- No source edits expected.

**Interfaces:**
- Produces working `node_modules/.bin/vitest.cmd`, `node_modules/.bin/playwright.cmd`, and TypeScript/build toolchain.

- [ ] **Step 1: Confirm package manager and current dependency state**

Run with pnpm `10.33.4` first on PATH. In this Codex desktop shell, the bundled runtime can put pnpm `11.7.0` before the project-pinned pnpm and trigger a `node_modules` purge prompt. If `Get-Command pnpm` points at `C:\Users\27933\.cache\codex-runtimes\...`, first run:

```powershell
$env:PATH = 'C:\Users\27933\AppData\Roaming\npm;' + $env:PATH
pnpm --version
```

Expected version: `10.33.4`.

Run:

```powershell
node -p "require('./package.json').packageManager"
Test-Path node_modules\.bin\vitest.cmd
Test-Path node_modules\.bin\playwright.cmd
Test-Path node_modules\.bin\tsc.cmd
```

Expected: package manager is `pnpm@10.33.4...`; any missing `.cmd` confirms dependency recovery is needed.

- [ ] **Step 2: Restore dependencies with frozen lockfile**

Run:

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
```

Expected: install exits `0`; `pnpm-lock.yaml` is not modified.

- [ ] **Step 3: If install attempts unwanted lockfile changes, stop and diagnose**

Run:

```powershell
git diff -- pnpm-lock.yaml package.json pnpm-workspace.yaml
```

Expected: no diff. If there is a diff, revert only generated dependency metadata after confirming it was not user-authored.

- [ ] **Step 4: Verify toolchain binaries exist**

Run:

```powershell
Test-Path node_modules\.bin\vitest.cmd
Test-Path node_modules\.bin\playwright.cmd
Test-Path node_modules\.bin\tsc.cmd
```

Expected: all three print `True`.

---

## Task 2: Lock Runtime Blackboard Projection Behind Focused Unit Tests

**Files:**
- Create or Modify: `openclaw_runtime/src/agents/orchestration-runtime-blackboard.ts`
- Modify: `openclaw_runtime/src/agents/orchestrator-run-observed.ts`
- Create: `tests/unit/orchestration-runtime-blackboard.test.ts`

**Interfaces:**
- Consumes: `OrchestrationResultBundle`, runtime `failures`, known role names.
- Produces:
  - `buildRuntimeBlackboard(input): { state: BlackboardState; summary: BlackboardSynthesisSummary; traceEvents: BlackboardTraceEvent[] }`
  - `OrchestrationRunResult.blackboardState`
  - `OrchestrationRunResult.blackboardSummary`
  - `OrchestrationRunResult.blackboardTraceEvents`

- [ ] **Step 1: Write failing tests for runtime blackboard projection**

Create `tests/unit/orchestration-runtime-blackboard.test.ts` with tests that assert:

```ts
import { describe, expect, it } from 'vitest';
import { buildRuntimeBlackboard } from '../../openclaw_runtime/src/agents/orchestration-runtime-blackboard';
import type { OrchestrationResultBundle } from '../../openclaw_runtime/src/agents/orchestration-result-bundle';

function bundle(): OrchestrationResultBundle {
  return {
    schemaVersion: 1,
    phase: 'spawn',
    orchestrationRunId: 'orch_runtime_bb',
    taskGraphId: 'graph_runtime_bb',
    attempt: 1,
    status: 'partial',
    leadRole: 'planner',
    selectedRoles: ['implementer', 'tester'],
    roleOutcomes: [
      {
        roleName: 'implementer',
        task: 'Implement bounded blackboard',
        phase: 'worker',
        taskId: 'impl-1',
        attempt: 1,
        status: 'completed',
        childRunId: 'run_impl',
        evidenceRefs: [{ type: 'trace', ref: 'trace:impl', roleName: 'implementer', taskId: 'impl-1' }],
        outputText: 'Implemented blackboard projection.',
      },
    ],
    artifacts: [],
    evidenceRefs: [{ type: 'trace', ref: 'trace:impl', roleName: 'implementer', taskId: 'impl-1' }],
    permissionEvents: [],
    failures: [{ roleName: 'tester', status: 'forbidden', error: 'max children reached' }],
    memoryProposals: [],
    traceIds: ['trace_runtime_bb'],
  };
}

describe('runtime orchestration blackboard projection', () => {
  it('derives typed entries, summary, and replayable trace events without granting authority', () => {
    const result = buildRuntimeBlackboard({
      resultBundle: bundle(),
      failures: [{ roleName: 'tester', status: 'forbidden', error: 'max children reached' }],
      knownRoleNames: ['planner', 'implementer', 'tester'],
      now: '2026-07-08T00:00:00.000Z',
    });

    expect(result.state.entries.map((entry) => entry.type)).toEqual(['claim', 'risk']);
    expect(result.summary).toMatchObject({
      entryCount: 2,
      openRisks: 1,
      unresolvedConflicts: 0,
      trustBoundaries: ['role-output'],
    });
    expect(result.traceEvents).toHaveLength(2);
    expect(result.state.entries.every((entry) => entry.trustBoundary === 'role-output')).toBe(true);
    expect(JSON.stringify(result.state.entries)).not.toContain('"tools"');
    expect(JSON.stringify(result.state.entries)).not.toContain('"permissions"');
    expect(JSON.stringify(result.state.entries)).not.toContain('"memoryWrite"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/orchestration-runtime-blackboard.test.ts
```

Expected: fails because `orchestration-runtime-blackboard` does not exist or `traceEvents` is missing.

- [ ] **Step 3: Extract/implement runtime blackboard helper**

Create `openclaw_runtime/src/agents/orchestration-runtime-blackboard.ts` with:

```ts
import {
  appendBlackboardEntry,
  createBlackboardState,
  detectBlackboardConflicts,
  type BlackboardState,
} from './orchestration-blackboard.js';
import type { BlackboardTraceEvent } from './orchestration-blackboard-trace.js';
import type { OrchestrationResultBundle } from './orchestration-result-bundle.js';
import type { BlackboardSynthesisSummary } from './orchestration-synthesizer.js';

export type RuntimeBlackboardFailure = { roleName: string; status: string; error?: string };

export type RuntimeBlackboardInput = {
  resultBundle: OrchestrationResultBundle;
  failures: readonly RuntimeBlackboardFailure[];
  knownRoleNames: readonly string[];
  now: string;
};

export type RuntimeBlackboardProjection = {
  state: BlackboardState;
  summary: BlackboardSynthesisSummary;
  traceEvents: BlackboardTraceEvent[];
};

function blackboardId(...parts: string[]): string {
  return parts
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'bb_entry';
}

function summaryFromState(state: BlackboardState): BlackboardSynthesisSummary {
  const visibleEntries = state.entries.filter((entry) => entry.status !== 'rejected' && entry.status !== 'superseded');
  return {
    entryCount: visibleEntries.length,
    unresolvedConflicts: visibleEntries.filter((entry) => entry.type === 'conflict' && entry.status === 'open').length,
    openQuestions: visibleEntries.filter((entry) => entry.type === 'question' && entry.status === 'open').length,
    openRisks: visibleEntries.filter((entry) => entry.type === 'risk' && entry.status === 'open').length,
    memoryProposals: visibleEntries.filter((entry) => entry.type === 'memory_proposal').length,
    evidenceRefs: [...new Set(visibleEntries.flatMap((entry) => entry.evidenceRefs))],
    trustBoundaries: [...new Set(visibleEntries.map((entry) => entry.trustBoundary))].sort(),
  };
}

export function buildRuntimeBlackboard(input: RuntimeBlackboardInput): RuntimeBlackboardProjection {
  let state = createBlackboardState();
  const traceEvents: BlackboardTraceEvent[] = [];
  const knownRoles = [...new Set([...input.knownRoleNames, ...input.resultBundle.selectedRoles, input.resultBundle.leadRole])];

  for (const outcome of input.resultBundle.roleOutcomes) {
    const evidenceRefs = outcome.evidenceRefs.map((ref) => ref.ref);
    const appended = appendBlackboardEntry(state, {
      id: blackboardId('bb', input.resultBundle.orchestrationRunId, outcome.roleName, outcome.taskId ?? outcome.childRunId ?? outcome.task),
      type: 'claim',
      authorRole: outcome.roleName,
      taskId: outcome.taskId ?? outcome.childRunId ?? outcome.task,
      content: {
        subject: outcome.task,
        conclusion: outcome.status,
        phase: outcome.phase,
        ...(outcome.outputText ? { outputPreview: outcome.outputText.trim().slice(0, 240) } : {}),
      },
      confidence: outcome.status === 'completed' ? 0.8 : 0.45,
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : input.resultBundle.traceIds,
      visibility: 'verifier',
      status: outcome.status === 'completed' ? 'resolved' : 'needs_review',
      trustBoundary: 'role-output',
    }, knownRoles, input.now);
    state = appended.state;
    if (appended.entry) {
      traceEvents.push({ seq: traceEvents.length + 1, kind: 'append', at: input.now, entry: appended.entry });
    }
  }

  for (const failure of input.failures) {
    const appended = appendBlackboardEntry(state, {
      id: blackboardId('bb', input.resultBundle.orchestrationRunId, failure.roleName, failure.status, failure.error ?? 'failure'),
      type: 'risk',
      authorRole: failure.roleName,
      taskId: failure.roleName,
      content: {
        subject: 'orchestration spawn failure',
        status: failure.status,
        error: failure.error ?? failure.status,
      },
      confidence: 0.9,
      evidenceRefs: input.resultBundle.traceIds,
      visibility: 'verifier',
      status: 'open',
      trustBoundary: 'role-output',
    }, knownRoles, input.now);
    state = appended.state;
    if (appended.entry) {
      traceEvents.push({ seq: traceEvents.length + 1, kind: 'append', at: input.now, entry: appended.entry });
    }
  }

  const conflictResult = detectBlackboardConflicts(state, knownRoles, input.now);
  state = conflictResult.state;
  for (const entry of conflictResult.conflicts) {
    traceEvents.push({ seq: traceEvents.length + 1, kind: 'append', at: input.now, entry });
  }

  return { state, summary: summaryFromState(state), traceEvents };
}
```

- [ ] **Step 4: Wire helper into observed runner**

In `openclaw_runtime/src/agents/orchestrator-run-observed.ts`, remove inline blackboard helper code and import:

```ts
import { buildRuntimeBlackboard, type RuntimeBlackboardFailure } from './orchestration-runtime-blackboard.js';
```

Extend `OrchestrationRunResult`:

```ts
blackboardTraceEvents: BlackboardTraceEvent[];
```

Return:

```ts
blackboardTraceEvents: blackboard.traceEvents,
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/orchestration-runtime-blackboard.test.ts tests/unit/role-orchestration-methods.test.ts
```

Expected: all tests pass.

---

## Task 3: Make Blackboard Trace Replay Prove Runtime History

**Files:**
- Modify: `tests/unit/orchestration-blackboard-trace.test.ts`
- Modify: `openclaw_runtime/src/agents/orchestration-blackboard-trace.ts` only if the current event type cannot represent runtime events.

**Interfaces:**
- Consumes: `RuntimeBlackboardProjection.traceEvents`.
- Produces: replayed blackboard state equivalent to runtime `blackboardState`.

- [ ] **Step 1: Add failing replay test using runtime events**

Append to `tests/unit/orchestration-blackboard-trace.test.ts`:

```ts
import { buildRuntimeBlackboard } from '../../openclaw_runtime/src/agents/orchestration-runtime-blackboard';

it('replays runtime blackboard events into the same verifier-visible state', () => {
  const projection = buildRuntimeBlackboard({
    resultBundle: {
      schemaVersion: 1,
      phase: 'spawn',
      orchestrationRunId: 'orch_replay_runtime',
      taskGraphId: 'graph_replay_runtime',
      attempt: 1,
      status: 'partial',
      leadRole: 'planner',
      selectedRoles: ['implementer', 'tester'],
      roleOutcomes: [{
        roleName: 'implementer',
        task: 'Implement replay',
        phase: 'worker',
        taskId: 'impl-replay',
        attempt: 1,
        status: 'completed',
        evidenceRefs: [{ type: 'trace', ref: 'trace:impl-replay' }],
      }],
      artifacts: [],
      evidenceRefs: [{ type: 'trace', ref: 'trace:impl-replay' }],
      permissionEvents: [],
      failures: [{ roleName: 'tester', status: 'forbidden', error: 'max children reached' }],
      memoryProposals: [],
      traceIds: ['trace_runtime_replay'],
    },
    failures: [{ roleName: 'tester', status: 'forbidden', error: 'max children reached' }],
    knownRoleNames: ['planner', 'implementer', 'tester'],
    now: '2026-07-08T00:00:00.000Z',
  });

  const replayed = replayBlackboardTrace(projection.traceEvents, ['planner', 'implementer', 'tester']);

  expect(replayed.issues).toEqual([]);
  expect(replayed.state.entries).toEqual(projection.state.entries);
});
```

- [ ] **Step 2: Run test to verify it fails if runtime events are not replayable**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/orchestration-blackboard-trace.test.ts
```

Expected before implementation: failure if `BlackboardTraceEvent` shape does not accept runtime events.

- [ ] **Step 3: Adjust trace event typing only if needed**

If the compiler rejects `seq`, `kind`, `at`, or `entry`, update `BlackboardTraceEvent` to support append events with:

```ts
export type BlackboardTraceEvent = {
  seq: number;
  kind: 'append' | 'update' | 'conflict';
  at: string;
  entry?: BlackboardEntry;
  entryId?: string;
  patch?: Partial<Pick<BlackboardEntry, 'content' | 'confidence' | 'evidenceRefs' | 'visibility' | 'status'>>;
  conflictsWith?: string[];
};
```

Do not add permission/tool/prompt fields to trace events.

- [ ] **Step 4: Run trace replay tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/orchestration-blackboard-trace.test.ts tests/unit/orchestration-runtime-blackboard.test.ts
```

Expected: all tests pass.

---

## Task 4: Verify Verifier Projection Includes Blackboard Evidence Without Bypassing Gates

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestration-blackboard-verifier.ts`
- Modify: `openclaw_runtime/src/agents/orchestration-synthesizer.ts`
- Modify: `tests/unit/orchestration-blackboard-verifier.test.ts`
- Modify: `tests/unit/orchestration-synthesizer.test.ts`

**Interfaces:**
- Consumes: `BlackboardState`.
- Produces verifier-readable projection and synthesis blackboard summary.

- [ ] **Step 1: Add failing test that blackboard evidence does not satisfy bundle evidence by itself**

In `tests/unit/orchestration-blackboard-verifier.test.ts`, add:

```ts
it('projects runtime blackboard evidence for verifier but still fails bundle gates without role evidence', () => {
  const projection = buildRuntimeBlackboard({
    resultBundle: {
      schemaVersion: 1,
      phase: 'spawn',
      orchestrationRunId: 'orch_blackboard_gate',
      taskGraphId: 'graph_blackboard_gate',
      attempt: 1,
      status: 'verified',
      leadRole: 'planner',
      selectedRoles: ['implementer'],
      roleOutcomes: [{
        roleName: 'implementer',
        task: 'Implement without evidence',
        phase: 'worker',
        taskId: 'impl-no-evidence',
        attempt: 1,
        status: 'completed',
        evidenceRefs: [],
      }],
      artifacts: [],
      evidenceRefs: [],
      permissionEvents: [],
      failures: [],
      memoryProposals: [],
      traceIds: ['trace_blackboard_gate'],
    },
    failures: [],
    knownRoleNames: ['planner', 'implementer'],
    now: '2026-07-08T00:00:00.000Z',
  });

  const verifierEvidence = readBlackboardVerifierEvidence(projection.state);
  expect(verifierEvidence).toHaveLength(1);
  expect(verifierEvidence[0]).toMatchObject({ verified: false, trustBoundary: 'role-output' });
});
```

- [ ] **Step 2: Run verifier projection tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-gates.test.ts
```

Expected: projection is readable, existing gates still reject missing role evidence.

- [ ] **Step 3: Add synthesis assertion for blackboard summary**

In `tests/unit/orchestration-synthesizer.test.ts`, assert:

```ts
expect(first.blackboardSummary).toMatchObject({
  entryCount: 5,
  trustBoundaries: ['role-output', 'tool-output'],
});
expect(first.policy).toEqual({
  toolAccess: 'none',
  verifierAuthority: 'preserved',
  memoryWrite: 'none',
});
```

- [ ] **Step 4: Run synthesizer tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/orchestration-synthesizer.test.ts tests/unit/orchestration-blackboard-verifier.test.ts
```

Expected: all pass.

---

## Task 5: Finish Agency Draft Promotion Boundary

**Files:**
- Modify: `openclaw_runtime/src/agents/agency-draft-catalog.ts`
- Modify: `tests/unit/agency-role-importer.test.ts`
- Optional if gateway API exists: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`

**Interfaces:**
- Consumes: `AgencyDraftRoleEntry`.
- Produces a review result that validates a `RoleContract` candidate but never mutates draft into runtime active state automatically.

- [ ] **Step 1: Add failing tests for explicit promotion review record**

In `tests/unit/agency-role-importer.test.ts`, add:

```ts
it('creates a promotion review record without activating Agency drafts', () => {
  const [draft] = importAgencyDraftRoles({
    divisions: [{
      id: 'engineering',
      agents: [{
        id: 'reviewer',
        name: 'Reviewer',
        description: 'Review implementation evidence and report blockers.',
      }],
    }],
  });

  const reviewed = {
    ...draft!,
    status: 'reviewed' as const,
    roleCandidate: {
      name: 'agency-reviewer-candidate',
      displayName: 'Agency Reviewer Candidate',
      description: 'Review implementation evidence and report blockers.',
      rolePrompt: 'Review implementation evidence and report blockers.',
      tools: ['read'],
      effort: 'medium',
      outputContract: { format: 'markdown', requiredSections: ['findings', 'evidence'] },
      permissions: { filesystem: 'read-only', network: 'none' },
    },
  };

  const review = reviewAgencyDraftPromotion(reviewed, {
    reviewer: 'operator',
    reviewedAt: '2026-07-08T00:00:00.000Z',
  });

  expect(review).toMatchObject({
    draftId: reviewed.id,
    approvedForRuntime: false,
    validation: { ok: true },
  });
  expect(canSpawnAgencyDraft(reviewed)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/agency-role-importer.test.ts
```

Expected: fails because `reviewAgencyDraftPromotion` is missing.

- [ ] **Step 3: Implement review helper**

In `openclaw_runtime/src/agents/agency-draft-catalog.ts`, add:

```ts
export type AgencyDraftPromotionReviewInput = {
  reviewer: string;
  reviewedAt: string;
};

export type AgencyDraftPromotionReview = {
  draftId: string;
  reviewer: string;
  reviewedAt: string;
  approvedForRuntime: false;
  validation: RoleContractValidationResult;
};

export function reviewAgencyDraftPromotion(
  entry: AgencyDraftRoleEntry,
  input: AgencyDraftPromotionReviewInput,
): AgencyDraftPromotionReview {
  return {
    draftId: entry.id,
    reviewer: input.reviewer,
    reviewedAt: input.reviewedAt,
    approvedForRuntime: false,
    validation: validateAgencyDraftPromotion(entry),
  };
}
```

This helper deliberately returns `approvedForRuntime: false`; activation must be a separate RoleContract registry/config action.

- [ ] **Step 4: Run Agency tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run tests/unit/agency-role-importer.test.ts
```

Expected: all pass; real repo import remains draft-only.

---

## Task 6: Complete P4 Dual-Column UI and E2E Coverage

**Files:**
- Modify: `src/components/agents/RolesOrchestrationPanel.tsx`
- Modify: `shared/i18n/locales/en/agents.json`
- Modify: `shared/i18n/locales/zh/agents.json`
- Modify: `shared/i18n/locales/ja/agents.json`
- Modify: `shared/i18n/locales/ru/agents.json`
- Modify: `tests/e2e/role-orchestration-synthesis.spec.ts`

**Interfaces:**
- Consumes: `synthesis` payload from `orchestrator.run`.
- Produces visible result layout:
  - Left: final synthesis, status, role outcomes.
  - Right: verifier, evidence refs, trace ids, blackboard summary, failures.

- [ ] **Step 1: Run E2E to capture current failure**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test tests/e2e/role-orchestration-synthesis.spec.ts
```

Expected before UI completion: failing assertions if evidence refs, trace ids, role outcomes, or blackboard summary are missing.

- [ ] **Step 2: Ensure UI renders exact details**

In `src/components/agents/RolesOrchestrationPanel.tsx`, verify the `data-testid="role-orchestration-synthesis"` block includes:

```tsx
{synthesis.roleContributions?.length ? (
  <div className="mt-3">
    <p className="text-2xs font-medium text-muted-foreground">{tt('roles.synthesisRoleOutcomes', 'Role outcomes')}</p>
    <ul className="mt-1 space-y-1">
      {compactList(synthesis.roleContributions, 5).map((role, index) => (
        <li key={`${role.roleName ?? 'role'}-${index}`} className="rounded-md bg-background/60 px-2.5 py-2 text-2xs text-muted-foreground">
          <span className="font-mono text-foreground">{role.roleName ?? '-'}</span>
          <span> · {role.status ?? '-'}</span>
          {role.phase ? <span> · {role.phase}</span> : null}
          {role.task ? <span className="block truncate">{role.task}</span> : null}
          {role.evidenceRefs?.length ? (
            <span className="block truncate font-mono text-muted-foreground">
              {compactList(role.evidenceRefs, 2).map(displayEvidenceRef).join(', ')}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  </div>
) : null}
```

And the right-side detail block includes verifier, evidence refs, trace ids, blackboard summary, and visible failures.

- [ ] **Step 3: Ensure four locale files contain all keys**

Each `shared/i18n/locales/<lang>/agents.json` must include:

```json
"synthesisRoleOutcomes": "...",
"synthesisEvidenceRefs": "...",
"synthesisTraceIds": "...",
"synthesisBlackboard": "...",
"synthesisBlackboardRisks": "...",
"synthesisBlackboardConflicts": "...",
"synthesisBlackboardQuestions": "...",
"synthesisBlackboardMemory": "..."
```

- [ ] **Step 4: Run JSON parse check**

Run:

```powershell
node -e "for (const f of ['shared/i18n/locales/en/agents.json','shared/i18n/locales/zh/agents.json','shared/i18n/locales/ja/agents.json','shared/i18n/locales/ru/agents.json']) { JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('ok', f) }"
```

Expected: four `ok` lines.

- [ ] **Step 5: Run P4 E2E**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test tests/e2e/role-orchestration-synthesis.spec.ts
```

Expected: all success/failure/repair-required/repair-after-success tests pass.

---

## Task 7: Full Role-First Acceptance Matrix

**Files:**
- No production changes unless failures identify root cause.
- Modify tests only with TDD if they reveal a real untested requirement.

**Interfaces:**
- Produces final evidence for delivery decision.

- [ ] **Step 1: Run focused role-first unit matrix**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run `
  tests/unit/agency-role-importer.test.ts `
  tests/unit/orchestration-gates.test.ts `
  tests/unit/orchestration-result-bundle.test.ts `
  tests/unit/orchestration-resource-scheduler.test.ts `
  tests/unit/runbook-template.test.ts `
  tests/unit/runbook-task-graph.test.ts `
  tests/unit/orchestration-blackboard.test.ts `
  tests/unit/orchestration-blackboard-verifier.test.ts `
  tests/unit/orchestration-blackboard-trace.test.ts `
  tests/unit/orchestration-runtime-blackboard.test.ts `
  tests/unit/orchestration-synthesizer.test.ts `
  tests/unit/orchestration-dynamic-dag.test.ts `
  tests/unit/role-orchestration-methods.test.ts
```

Expected: all files pass.

- [ ] **Step 2: Run P4 Electron E2E**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test tests/e2e/role-orchestration-synthesis.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm run typecheck
```

Expected: exits `0`.

- [ ] **Step 4: Run frontend/Electron build**

Run:

```powershell
node --max-old-space-size=6144 ./node_modules/vite/bin/vite.js build
```

Expected: exits `0`; only pre-existing chunk/import warnings are acceptable.

- [ ] **Step 5: Run comms replay/compare because orchestration paths touch gateway/tool results**

Run:

```powershell
node scripts/comms/replay.mjs
node scripts/comms/compare.mjs
```

Expected: both exit `0`.

- [ ] **Step 6: Run harness validation where diff scope allows it**

Run:

```powershell
pnpm harness validate --spec harness/specs/scenarios/gateway-backend-communication.md --no-diff
pnpm harness run --spec harness/specs/scenarios/gateway-backend-communication.md --dry-run
```

Expected: structural validation and dry-run pass. If diff-aware validation still fails because multiple phase files are intentionally in one working tree, document the exact rejection and do not call it a pass.

---

## Task 8: Delivery Audit Against Development Plan

**Files:**
- Create: `docs/multi-agent-orchestration/2026-07-08-role-first-completion-audit.md`

**Interfaces:**
- Produces human-readable acceptance matrix.

- [ ] **Step 1: Create audit document**

Create `docs/multi-agent-orchestration/2026-07-08-role-first-completion-audit.md` with sections:

```markdown
# Role-First Multi-Agent Completion Audit

## Scope

Audits implementation against `docs/multi-agent-orchestration-development-plan.md`.

## Result

| Area | Status | Evidence |
|---|---|---|
| RoleContract-only runtime role channel | PASS/FAIL | file + test |
| Agency draft-only import | PASS/FAIL | file + test |
| Runtime scheduler max active roles | PASS/FAIL | file + test |
| P0 bundle/schema/verifier/repair gates | PASS/FAIL | file + test |
| P2 runbook/complexity trace | PASS/FAIL | file + test |
| P3 typed runtime blackboard | PASS/FAIL | file + test |
| P3 trace replay reconstruction | PASS/FAIL | file + test |
| P3 bounded A2A policy | PASS/FAIL | file + test |
| P4 synthesizer no tool/memory authority | PASS/FAIL | file + test |
| P4 dual-column UI | PASS/FAIL | file + E2E |
| P4 success/failure/repair E2E | PASS/FAIL | command output |
| Full verification gate | PASS/FAIL | command output |

## Residual Risks

- List only verified residual risks, not speculation.
```

- [ ] **Step 2: Fill audit with exact command results**

Use the outputs from Task 7. Do not mark `PASS` unless the command was run fresh in this round and exited `0`.

- [ ] **Step 3: Run markdown/path sanity checks**

Run:

```powershell
Test-Path docs/multi-agent-orchestration/2026-07-08-role-first-completion-audit.md
rg -n "PASS|FAIL|Residual" docs/multi-agent-orchestration/2026-07-08-role-first-completion-audit.md
```

Expected: file exists and contains filled matrix entries.

---

## Self-Review Checklist

- Spec coverage:
  - P0 gates and trace/bundle evidence are re-verified in Task 7.
  - P1 scheduler and Agency draft-only are re-verified in Task 5 and Task 7.
  - P2 runbook/complexity path is re-verified in Task 7.
  - P3 runtime blackboard, trace replay, verifier projection, and bounded A2A are covered in Tasks 2-4 and Task 7.
  - P4 synthesizer, dynamic DAG existing tests, dual-column UI, and success/failure/repair E2E are covered in Tasks 6-7.
- Placeholder scan:
  - No implementation step uses TBD/TODO/fill-later language.
  - Commands and expected results are explicit.
- Type consistency:
  - `blackboardState`, `blackboardSummary`, and `blackboardTraceEvents` are produced by runtime and consumed by gateway/tool/UI/tests.
  - Agency promotion review remains non-activating and cannot spawn.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-07-08-role-first-multi-agent-completion.md`.

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fastest for the independent test/runtime/UI/audit work.
2. **Inline Execution** - execute tasks in this session using executing-plans, with checkpoints after each task.
