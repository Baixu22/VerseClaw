# Role-First P3 Typed Blackboard And Bounded A2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed orchestration blackboard with bounded A2A semantics without widening into P4 synthesizer, UI, open chat, or memory persistence.

**Architecture:** Add focused runtime modules for blackboard entry validation, append/versioned update operations, conflict detection, verifier evidence reads, and trace replay reconstruction. The blackboard stores structured orchestration data only; existing RoleContract, scheduler, runbook, result bundle, schema gate, verifier gate, and memory governance boundaries remain authoritative.

**Tech Stack:** TypeScript, OpenClaw runtime modules under `openclaw_runtime/src/agents/**`, Vitest unit tests, existing harness specs, pnpm.

## Global Constraints

- Active phase is P3 only.
- `docs/multi-agent-orchestration-development-plan.md` is the binding global constraint document.
- `docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md` is the binding phase constraint.
- `RoleContract` is the only legal runtime role channel.
- Prompt/persona/Agency markdown/handoff prose/blackboard prose must not grant permissions.
- Blackboard entries are orchestration data, not direct worker chat and not long-term memory.
- Worker-authored and external content is untrusted by default.
- Blackboard-generated evidence must still pass through `SchemaComplianceGate` and `VerifierGate`.
- Runtime execution must still pass through `ResourceAwareWaveScheduler`.
- Runbook-generated graphs must still use P2 runbook boundaries.
- Do not implement synthesizer, Role Catalog UI, open mesh A2A, direct worker-to-worker chat, or new long-term memory strategy.
- Follow TDD: write focused failing test, run RED, implement, run GREEN.

---

## File Structure

Create:

- `openclaw_runtime/src/agents/orchestration-blackboard.ts`
  Owns blackboard entry types, validation, append/update operations, conflict detection, trust metadata, and in-memory blackboard state helpers.
- `openclaw_runtime/src/agents/orchestration-blackboard-verifier.ts`
  Owns read-only verifier evidence projection from blackboard entries.
- `openclaw_runtime/src/agents/orchestration-blackboard-trace.ts`
  Owns blackboard trace event types and replay reconstruction.
- `tests/unit/orchestration-blackboard.test.ts`
  Covers entry validation, append, versioned update, conflict detection, trust boundary, and unsafe field rejection.
- `tests/unit/orchestration-blackboard-verifier.test.ts`
  Covers verifier read helpers without bypassing P0 gates.
- `tests/unit/orchestration-blackboard-trace.test.ts`
  Covers replay reconstruction from append/update/conflict events.

Modify only if needed:

- `openclaw_runtime/src/agents/orchestrator.ts`
  Thread blackboard metadata through existing orchestration state without changing worker permissions or scheduler enforcement.
- `openclaw_runtime/src/agents/orchestration-result-bundle.ts`
  Add narrow blackboard evidence refs only if tests prove the result bundle needs them.
- `openclaw_runtime/src/agents/orchestration-gates.ts`
  Allow verifier input to cite blackboard evidence refs without weakening schema or verifier checks.
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
  Expose structured blackboard metadata only if existing tool responses already expose orchestration details.
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
  Preserve existing response shape while adding blackboard metadata only if run results expose it.

## Interfaces

The blackboard module should converge on these names:

```ts
export type BlackboardEntryType =
  | "fact"
  | "claim"
  | "question"
  | "risk"
  | "decision"
  | "artifact"
  | "conflict"
  | "handoff"
  | "memory_proposal";

export type BlackboardTrustBoundary =
  | "trusted-system"
  | "role-output"
  | "tool-output"
  | "file-content"
  | "external-content";

export type BlackboardVisibility = "run" | "role" | "verifier" | "public-result";
export type BlackboardStatus = "open" | "resolved" | "superseded" | "rejected" | "needs_review";

export type BlackboardEntry = {
  id: string;
  type: BlackboardEntryType;
  authorRole: string;
  taskId: string;
  content: Record<string, unknown>;
  confidence: number;
  evidenceRefs: string[];
  visibility: BlackboardVisibility;
  status: BlackboardStatus;
  trustBoundary: BlackboardTrustBoundary;
  version: number;
  createdAt: string;
  updatedAt: string;
  supersedes?: string;
  conflictsWith?: string[];
};

export type BlackboardValidationIssue = {
  path: string;
  message: string;
};

export type BlackboardValidationResult = {
  ok: boolean;
  issues: BlackboardValidationIssue[];
};

export function validateBlackboardEntry(
  entry: BlackboardEntry,
  knownRoleNames: readonly string[],
): BlackboardValidationResult;
```

Append/update APIs should converge on these names:

```ts
export type BlackboardState = {
  entries: BlackboardEntry[];
};

export function createBlackboardState(): BlackboardState;
export function appendBlackboardEntry(
  state: BlackboardState,
  entry: Omit<BlackboardEntry, "version" | "createdAt" | "updatedAt">,
  knownRoleNames: readonly string[],
  now?: string,
): { state: BlackboardState; entry: BlackboardEntry; issues: BlackboardValidationIssue[] };

export function updateBlackboardEntry(
  state: BlackboardState,
  entryId: string,
  patch: Partial<Pick<BlackboardEntry, "content" | "confidence" | "evidenceRefs" | "visibility" | "status">>,
  knownRoleNames: readonly string[],
  now?: string,
): { state: BlackboardState; entry?: BlackboardEntry; issues: BlackboardValidationIssue[] };
```

## Task 1: Harness And P3 Preflight

**Files:**
- Read: `docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md`
- Read: `docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md`
- Read: `docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md`
- Read: `harness/specs/tasks/role-first-p3-typed-blackboard.md`

**Interfaces:**
- Consumes: P3 harness task spec and control pack.
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
pnpm harness context --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
```

Expected: command lists P3 task, gateway communication scenario/rules, openclaw runtime layer, and docs control pack.

- [ ] **Step 3: Validate harness spec**

Run:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md --no-diff
```

Expected: PASS.

## Task 2: Blackboard Entry Validation

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-blackboard.ts`
- Create: `tests/unit/orchestration-blackboard.test.ts`

**Interfaces:**
- Consumes: `BlackboardEntry`, known role names.
- Produces: `validateBlackboardEntry()`.

- [ ] **Step 1: Write failing entry validation tests**

Create tests that assert:

- each supported entry type can validate,
- unknown entry type fails,
- unknown author role fails,
- missing task id fails,
- confidence below 0 or above 1 fails,
- invalid visibility fails,
- invalid status fails,
- evidence-required entry types fail when evidence refs are empty,
- content fields named `tools`, `permissions`, `prompt`, or `memoryWrite` fail.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts
```

Expected: FAIL because `orchestration-blackboard.ts` does not exist.

- [ ] **Step 3: Implement minimal validation**

Create `openclaw_runtime/src/agents/orchestration-blackboard.ts` with the interfaces above. Reject unsafe content keys recursively. Require evidence refs for `fact`, `claim`, `decision`, `artifact`, `conflict`, and `memory_proposal`.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts
```

Expected: PASS.

## Task 3: Append And Versioned Update API

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestration-blackboard.ts`
- Modify: `tests/unit/orchestration-blackboard.test.ts`

**Interfaces:**
- Consumes: `BlackboardState`, `appendBlackboardEntry()`, `updateBlackboardEntry()`.
- Produces: append-only history with versioned updates.

- [ ] **Step 1: Add failing append/update tests**

Assert:

- append creates version 1 with stable timestamps,
- append returns validation issues and does not mutate state for invalid entries,
- update creates a new version and marks the prior version as superseded,
- update cannot change `authorRole`, `taskId`, `type`, or `trustBoundary`,
- old versions remain available in `state.entries`.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts -t "append|update|version"
```

Expected: FAIL because append/update APIs are missing.

- [ ] **Step 3: Implement append/update**

Add `createBlackboardState()`, `appendBlackboardEntry()`, and `updateBlackboardEntry()`. Use immutable state returns and preserve prior versions.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts
```

Expected: PASS.

## Task 4: Conflict Detection And Bounded Handoff

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestration-blackboard.ts`
- Modify: `tests/unit/orchestration-blackboard.test.ts`

**Interfaces:**
- Consumes: claim and handoff entries.
- Produces: conflict entries and structured handoff validation.

- [ ] **Step 1: Add failing conflict and handoff tests**

Assert:

- two claims with the same `content.subject` and incompatible `content.conclusion` create one conflict entry,
- the conflict entry references both claim ids in `conflictsWith`,
- neither original claim is removed,
- handoff entries require structured `fromRole`, `toRole`, `summary`, and `evidenceRefs`,
- handoff text does not grant permissions.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts -t "conflict|handoff"
```

Expected: FAIL because conflict/handoff behavior is missing.

- [ ] **Step 3: Implement conflict and handoff behavior**

Add deterministic conflict detection for claim entries. Keep detection conservative: only create conflicts when `subject` matches and normalized `conclusion` differs.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts
```

Expected: PASS.

## Task 5: Trust Boundary And Prompt-Injection Defense

**Files:**
- Modify: `openclaw_runtime/src/agents/orchestration-blackboard.ts`
- Modify: `tests/unit/orchestration-blackboard.test.ts`

**Interfaces:**
- Consumes: untrusted content and trust metadata.
- Produces: structured untrusted-content propagation.

- [ ] **Step 1: Add failing trust-boundary tests**

Assert:

- role output defaults to `role-output`,
- tool output and file content are accepted only as untrusted data,
- instruction-like content such as "ignore previous instructions" remains in `content.text`,
- untrusted content cannot set `trustBoundary: "trusted-system"` unless the append caller supplies a trusted system source,
- untrusted content does not create tools, permissions, prompts, or memory writes.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts -t "trust|injection|untrusted"
```

Expected: FAIL because trust-boundary enforcement is incomplete.

- [ ] **Step 3: Implement trust-boundary enforcement**

Add validation for trust boundary values and reject trusted-system entries from worker-authored append paths.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts
```

Expected: PASS.

## Task 6: Verifier Evidence Read Helpers

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-blackboard-verifier.ts`
- Create: `tests/unit/orchestration-blackboard-verifier.test.ts`
- Modify only if required: `openclaw_runtime/src/agents/orchestration-gates.ts`

**Interfaces:**
- Consumes: blackboard entries and existing verifier gate inputs.
- Produces: read-only evidence projection for verifier use.

- [ ] **Step 1: Write failing verifier evidence tests**

Assert:

- verifier projection returns only entries visible to `verifier` or `run`,
- returned items include id, type, evidence refs, confidence, trust boundary, and status,
- rejected/superseded entries are excluded by default,
- projection does not mark evidence as verified,
- `SchemaComplianceGate` and `VerifierGate` still decide pass/fail.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard-verifier.test.ts
```

Expected: FAIL because verifier helper module does not exist.

- [ ] **Step 3: Implement verifier projection**

Create a read-only helper that filters entries and returns structured evidence summaries. Do not mutate gates or verifier results unless tests require a narrow reference field.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard-verifier.test.ts
```

Expected: PASS.

## Task 7: Trace Replay Reconstruction

**Files:**
- Create: `openclaw_runtime/src/agents/orchestration-blackboard-trace.ts`
- Create: `tests/unit/orchestration-blackboard-trace.test.ts`

**Interfaces:**
- Consumes: blackboard append/update/conflict trace events.
- Produces: reconstructed `BlackboardState`.

- [ ] **Step 1: Write failing trace replay tests**

Assert:

- append event reconstructs an entry,
- update event reconstructs prior and new versions,
- conflict event reconstructs conflict entries with `conflictsWith`,
- replay rejects events with unknown roles or invalid entry shape,
- replay order is deterministic.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard-trace.test.ts
```

Expected: FAIL because trace module does not exist.

- [ ] **Step 3: Implement trace replay**

Create trace event types and `replayBlackboardTrace()` using the append/update validation paths.

- [ ] **Step 4: Run test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard-trace.test.ts
```

Expected: PASS.

## Task 8: Integration Metadata Only

**Files:**
- Modify only if needed: `openclaw_runtime/src/agents/orchestrator.ts`
- Modify only if needed: `openclaw_runtime/src/agents/orchestration-result-bundle.ts`
- Modify only if needed: `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- Modify only if needed: `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- Modify only if needed: `tests/unit/role-orchestration-methods.test.ts`

**Interfaces:**
- Consumes: blackboard summary metadata.
- Produces: structured response metadata without runtime authority changes.

- [ ] **Step 1: Add focused failing metadata test only if integration is required**

If blackboard metadata is exposed through existing orchestration responses, assert the response may include:

- `blackboardSummary`,
- `blackboardEvidenceRefs`,
- existing `schedulerMetrics`,
- existing `resultBundle`.

- [ ] **Step 2: Run focused test to verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "blackboard"
```

Expected: FAIL only if integration metadata is not yet exposed.

- [ ] **Step 3: Integrate metadata only**

Thread read-only blackboard metadata through existing response data. Do not change role permissions, worker prompts, scheduler enforcement, runbook selection, schema gates, or verifier authority.

- [ ] **Step 4: Run focused test to GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/role-orchestration-methods.test.ts -t "blackboard"
```

Expected: PASS if metadata integration was added.

## Task 9: Phase Gate Suite And Documentation Sync Check

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

**Interfaces:**
- Consumes: all P3 changed files.
- Produces: final verification evidence.

- [ ] **Step 1: Run P3 unit suite**

Run:

```powershell
pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-blackboard-trace.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run P0/P1/P2 regression suite**

Run:

```powershell
pnpm exec vitest run tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run harness validation**

Run:

```powershell
pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
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
rg -n "Synthesizer|Role Catalog|direct worker-to-worker|open mesh A2A|Agency markdown runtime|memory persistence" openclaw_runtime src tests docs/multi-agent-orchestration docs/superpowers
```

Expected: Matches only docs/tests explaining non-goals, not production implementations for P4/UI/open-chat/memory persistence.

## Self-Review Checklist

- Blackboard entries are typed and validated.
- Append/update preserves history.
- Conflicts create entries instead of overwriting claims.
- Untrusted content remains data.
- Verifier evidence reads preserve P0 gates.
- Scheduler and runbook boundaries remain intact.
- No direct worker-to-worker chat is introduced.
- No blackboard entry grants tools or permissions.
- No blackboard entry automatically becomes long-term memory.
- Existing P0/P1/P2 tests remain green.
- Final report includes exact command results from the current run.
