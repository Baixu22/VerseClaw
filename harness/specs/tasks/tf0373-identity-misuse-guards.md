---
lifecycleStatus: active
id: tf0373-identity-misuse-guards
title: TF-0373 Identity Misuse Removal and Guards
type: task
intent: Remove the known real-path identity aliases while preserving existing wire and persistence formats, and add negative guards that fail on the old aliases.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - electron/services/agent-browser-api.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/handoff-artifacts.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - shared/types/identity-scope.ts
  - shared/product-semantics.ts
  - src/pages/Chat/execution-projection.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/TeamOrchestrationCard.tsx
  - src/pages/Chat/team-orchestration-visualization.ts
  - tests/unit/agent-steering-team-bundle.test.ts
  - tests/unit/execution-projection.test.ts
  - tests/unit/handoff-artifacts.test.ts
  - tests/unit/identity-scope.test.ts
  - tests/unit/resource-envelope.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - harness/specs/tasks/tf0373-identity-misuse-guards.md
---

# TF-0373 Identity Misuse Removal and Guards

## Objective

Repair only the already located real-path identity aliases called out by TF-0373: browser workspace fallback, steering and handoff task identity, Chat run association, and completion display. Keep Task Ledger, Task Loop, orchestration, storage and transport formats intact.

## Scope

- A browser resource entry must not use `sessionKey` or `sessionId` as a missing workspace.
- Steering and handoff references compare `taskNodeId` only; a same-string `taskId` is not the ledger identity.
- Chat run cards retain the route-local bare `runId` only for compatibility and expose an optional `ScopedRunId` when the workspace owner is known.
- Completion display has one shared authority mapping and cannot label a bare status as completed without authority.
- Existing wire keys, Task Ledger ownership, Task Loop status semantics, persisted schemas and frozen defaults stay unchanged.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm exec vitest run tests/unit/identity-scope.test.ts tests/unit/resource-envelope.test.ts tests/unit/handoff-artifacts.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/execution-projection.test.ts tests/unit/product-semantics.test.ts` passes.
- `pnpm harness validate --spec harness/specs/tasks/tf0373-identity-misuse-guards.md` passes.
- `pnpm run lint:check` passes.
- `pnpm run i18n:lint` passes.
- `pnpm run comms:replay` and `pnpm run comms:compare` pass.
- Playwright smoke coverage proves an accepted worker node is not rendered as a completed turn.
- `git diff --check` passes.
- The negative tests fail if the previous `sessionKey` fallback or `taskNodeId ?? taskId` alias is restored.
- No full-repo rename, new persistence migration, new task/run/trace authority, product lock change or downstream TF-0374 implementation is included.

## Notes

This slice is bounded by TF-0373 and its parent TF-0371. A missing workspace remains missing; no compatibility helper may infer it from a session. Artifacts and test receipts are agent-driven and labelled as such.
