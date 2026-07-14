# Agency Role Promotion Control Plane Round Constraints

> Active project: Agency Role Promotion Control Plane only.
>
> Worktree: `C:\Users\27933\Desktop\clawx\ClawX-role-promotion`
>
> Branch: `codex/agency-role-promotion-control-plane`

## 1. One-Round Rule

One development run owns one round. A worker must not implement the next round
in the same run unless the user explicitly authorizes continued execution after
reviewing the current round report.

Before every round:

1. read `AGENTS.md` and every scoped `AGENTS.md` for touched paths;
2. read the binding design, this document, active plan tasks, Harness task, and
   Harness rule;
3. inspect the required source and open-source references for that round;
4. run the round preflight commands;
5. report the current Git status and unrelated changes;
6. stop if a binding document or required reference is missing.

Every production round follows RED -> GREEN:

1. add a focused failing test;
2. run it and record the expected failure;
3. implement the smallest complete behavior;
4. rerun the focused test;
5. run the round exit gate;
6. report evidence before starting another round.

## 2. Global Forbidden Changes

All rounds forbid:

- changing `canSpawnAgencyDraft()` to return true;
- adding Agency drafts to `buildRoleRegistry()`;
- spawning Agency Markdown or prompt text;
- deriving tools or permissions from lifecycle, evidence, prose, division, or
  runbook metadata;
- automatic tool-hint acceptance;
- direct Renderer IPC, filesystem, Gateway HTTP, or Gateway WebSocket access;
- a second role registry, permission evaluator, spawn path, memory store, or
  tool executor;
- ToolRule execution or sequencing;
- shared memory, self-editing, sleeptime, background consolidation, provider
  fallback, or bulk promotion;
- unrelated refactors;
- resetting, reverting, checking out, or deleting user changes.

## 3. R0: Preflight And Reference Ledger

### Objective

Prove the isolated workspace, binding documents, external references, pinned
toolchain, current baseline, and Harness context are available.

### Allowed files

- documentation and Harness spec corrections only;
- no production TypeScript or TSX.

### Required references

- `AGENTS.md`
- `openclaw_runtime/AGENTS.md`
- `docs/superpowers/specs/2026-07-12-agency-role-promotion-control-plane-design.md`
- `docs/superpowers/plans/2026-07-12-agency-role-promotion-control-plane.md`
- `harness/specs/tasks/agency-role-promotion-control-plane.md`
- `harness/specs/rules/agency-role-promotion-boundary.md`
- original proposal attachment
- Agency `divisions.json`, `tools.json`, `strategy/runbooks.json`
- Letta `schemas/agent.py`, `schemas/tool_rule.py`

### Commands

```powershell
git status --short
git branch --show-current
pnpm harness context --spec harness/specs/tasks/agency-role-promotion-control-plane.md
pnpm harness validate --spec harness/specs/tasks/agency-role-promotion-control-plane.md --no-diff
pnpm exec vitest run tests/unit/agency-role-importer.test.ts tests/unit/roles-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/roles-orchestration-panel.test.tsx
```

### Exit criteria

- branch is `codex/agency-role-promotion-control-plane`;
- all binding documents and external references exist;
- Harness structural validation passes;
- baseline test result is recorded with exact file/test counts;
- report includes a reference ledger with at least one learned constraint per
  inspected reference;
- no production file changed.

## 4. R1: Immutable Source And Promotion Domain

### Objective

Add repository-relative source identity, stable content fingerprints, explicit
tool-hint dispositions, pure candidate validation, and separate contract
materialization.

### Allowed files

- `openclaw_runtime/src/agents/agency-draft-catalog.ts`
- `openclaw_runtime/src/agents/agency-role-importer.ts`
- `openclaw_runtime/src/agents/agency-role-promotion.ts`
- `tests/unit/agency-role-importer.test.ts`
- `tests/unit/agency-role-promotion.test.ts`

### Required references

- ClawX `role-contract.ts`, `role-registry.ts`, `role-spawn.ts`
- current Agency draft/importer files and tests
- Agency `divisions.json`, `tools.json`, and three representative candidates
- Letta `schemas/tool_rule.py` and `helpers/tool_rule_solver.py`

### Required proof

```powershell
pnpm exec vitest run tests/unit/agency-role-importer.test.ts tests/unit/agency-role-promotion.test.ts
```

### Exit criteria

- draft status is immutable and `canSpawnAgencyDraft()` remains literal false;
- source identity excludes absolute paths;
- normalized contract digest is deterministic;
- missing/duplicate hint dispositions fail;
- mapped hints require selected tools;
- waived hints require reasons;
- evidence-qualified candidates require evidence refs;
- materialized tools contain only explicitly mapped selections;
- lifecycle/evidence tests prove no permission derivation;
- focused tests pass and RED -> GREEN evidence is recorded.

## 5. R2: Typed Host Contract

### Objective

Declare the complete JSON-safe Host API contract before Main or Renderer uses
the feature.

### Allowed files

- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- `tests/unit/host-api-facade.test.ts`

### Required references

- existing `roles` declarations in `shared/host-api/contract.ts`
- existing `roles` facade in `src/lib/host-api.ts`
- `tests/unit/host-api-facade.test.ts`
- `harness/specs/rules/contract-first-boundary.md`
- `harness/specs/rules/host-api-fallback-policy.md`

### Required proof

```powershell
pnpm exec vitest run tests/unit/host-api-facade.test.ts
pnpm contract:check
```

### Exit criteria

- all list/preview/review/approve/retire payloads and results are explicit;
- facade forwards exact module/action/payload triples;
- no generic `unknown` escape hatch is added to Role promotion methods;
- contract drift check passes;
- no Main or UI implementation is included.

## 6. R3: Main Persistence And Config Materialization

### Objective

Implement Main-owned source reads, bounded audit persistence, review,
idempotent approval, exact-digest reconciliation, and guarded retirement.

### Allowed files

- `electron/services/role-promotion-store.ts`
- `electron/services/roles-api.ts`
- `tests/unit/roles-api.test.ts`

### Required references

- `electron/services/roles-api.ts`
- `electron/services/orchestration-presets-api.ts`
- `electron/services/permissions-api.ts`
- `electron/utils/config-mutex.ts`
- `electron/utils/channel-config.ts`
- runtime modules produced by R1
- Letta `schemas/agent.py` for approval/state separation only

### Required proof

```powershell
pnpm exec vitest run tests/unit/roles-api.test.ts tests/unit/agency-role-promotion.test.ts tests/unit/agency-role-importer.test.ts
pnpm contract:check
```

### Exit criteria

- invalid/missing Agency repositories fail without persistence;
- preview has no side effect;
- review persists without writing `agents.roles`;
- approval persists pending before config materialization;
- retries do not duplicate roles or records;
- exact contract digest reconciles interrupted writes;
- failures remain visible with sanitized messages;
- retirement cannot remove a same-name replacement;
- audit history remains after retirement;
- no Renderer change is included.

## 7. R4: Review UI And Four Locales

### Objective

Expose the complete review workflow through the typed facade with four-locale
coverage and without enlarging the existing orchestration panel's ownership.

### Allowed files

- `src/components/agents/AgencyRolePromotionPanel.tsx`
- `src/components/agents/RolesOrchestrationPanel.tsx`
- `tests/unit/agency-role-promotion-panel.test.tsx`
- `tests/unit/roles-orchestration-panel.test.tsx`
- `shared/i18n/locales/en/agents.json`
- `shared/i18n/locales/zh/agents.json`
- `shared/i18n/locales/ja/agents.json`
- `shared/i18n/locales/ru/agents.json`

### Required references

- existing role config section in `RolesOrchestrationPanel.tsx`
- `tests/unit/roles-orchestration-panel.test.tsx`
- `tests/e2e/role-management.spec.ts`
- `src/styles/globals.css` component conventions
- all four existing `agents.json` locale files

### Required proof

```powershell
pnpm exec vitest run tests/unit/agency-role-promotion-panel.test.tsx tests/unit/roles-orchestration-panel.test.tsx
pnpm i18n:lint
pnpm exec vitest run tests/unit/i18n-lint.test.ts
```

### Exit criteria

- source selection uses `hostApi.dialog.open`;
- all backend actions use `hostApi.roles`;
- draft search and candidate editor work at desktop/mobile constraints;
- tool hints cannot be silently accepted;
- review precedes approval;
- source draft never displays Active;
- lifecycle and evidence badges are separate;
- retry and retirement states are visible;
- four locale key trees match;
- no hardcoded user-visible strings or direct IPC/Gateway calls;
- focused renderer and i18n tests pass.

## 8. R5: Product Acceptance And Documentation

### Objective

Prove the real Electron workflow, synchronize architecture/user docs, and run
the complete task gate.

### Allowed files

- `tests/e2e/agency-role-promotion.spec.ts`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`
- corrections required by acceptance failures in R1-R4 owned files

### Required references

- `tests/e2e/fixtures/electron.ts`
- `tests/e2e/role-management.spec.ts`
- all binding design/plan/Harness documents
- Agency `strategy/runbooks.json` for evidence-reference semantics
- full Letta reference ledger to confirm excluded systems were not copied

### Required proof

```powershell
pnpm exec vitest run tests/unit/agency-role-importer.test.ts tests/unit/agency-role-promotion.test.ts tests/unit/roles-api.test.ts tests/unit/host-api-facade.test.ts tests/unit/agency-role-promotion-panel.test.tsx tests/unit/roles-orchestration-panel.test.tsx tests/unit/role-contract-drift.test.ts
pnpm contract:check
pnpm i18n:lint
pnpm run typecheck
pnpm run lint
pnpm run comms:replay
pnpm run comms:compare
pnpm run build:vite
pnpm exec playwright test tests/e2e/agency-role-promotion.spec.ts tests/e2e/role-management.spec.ts
pnpm harness validate --spec harness/specs/tasks/agency-role-promotion-control-plane.md
pnpm harness run --spec harness/specs/tasks/agency-role-promotion-control-plane.md --dry-run
git diff --check
```

### Exit criteria

- all commands pass with fresh evidence;
- E2E covers source selection, map/waive, evidence, review, approval, pending
  refresh, exact payloads, and retirement;
- docs describe only shipped behavior;
- final reference ledger lists files actually inspected and resulting decisions;
- final acceptance checklist marks every criterion PASS or gives an explicit
  blocker;
- final non-goal checklist confirms excluded systems were not implemented;
- final diff contains only project-owned files.

## 9. Mandatory End-Of-Round Report

Every round report must contain:

```text
Active round:
Goal:
Files changed and responsibility:
References inspected:
Constraint learned from each reference:
RED evidence:
GREEN evidence:
Commands and exact results:
Acceptance checklist:
Forbidden-scope audit:
Unrelated dirty files/failures:
Ready for next round: yes/no
```

An Agent must not claim a round complete when any required command was skipped.
