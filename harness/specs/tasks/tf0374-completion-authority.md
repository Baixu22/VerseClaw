---
lifecycleStatus: active
id: tf0374-completion-authority
title: TF-0374 Freeze Completion Authority and Display Rules
type: task
intent: Give completion one finite authority vocabulary and one presentation mapping so Chat final, Task Loop verification, and task-ledger completion cannot impersonate one another.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/identity-scope.ts
  - shared/product-semantics.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/pages/Chat/execution-projection.ts
  - tests/unit/identity-scope.test.ts
  - tests/e2e/task-loop-panel.spec.ts
  - harness/specs/tasks/tf0374-completion-authority.md
---

# TF-0374 Freeze Completion Authority and Display Rules

## Objective

Define the shared completion vocabulary (`turnStatus`, `runStatus`, `verification`, `taskStatus`, `completionAuthority`) and use it from UI presentation. This node unifies display; it does not introduce a new completion decision maker.

## Scope

- `CompletionAuthority` stays a finite enum: `turn`, `run`, `task-loop-verification`, `task-ledger`.
- A completed status without an authority is presented as `unavailable`; callers cannot infer task completion from a bare label.
- Ordinary Chat finals remain run-level facts.
- A Task Loop pass is displayed only when both its owner status and evidence gate authorize it, without changing Task Loop controller states.
- Existing Task Ledger and Task Loop semantics, persistence and frozen defaults stay unchanged.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm exec vitest run tests/unit/identity-scope.test.ts tests/unit/product-semantics.test.ts tests/unit/execution-projection.test.ts` passes.
- Task Loop UI retains the gate result and distinguishes a verified pass from an unavailable verifier.
- `pnpm harness validate --spec harness/specs/tasks/tf0374-completion-authority.md` passes.
- `git diff --check` passes.
- Unit tests cover Chat final, Task Loop passed, and verification unavailable.
- No completion decision engine, Task Ledger migration, Task Loop state-machine change or downstream TF-0375 implementation is included.