---
lifecycleStatus: active
id: coding-run-projection-export
title: CodingRun Read-Only Projection and JSONL Export (TF-0377)
type: task
intent: Project existing Chat and Task Loop facts into the shared CodingRun view, show the same read-only JSONL in their existing UI surfaces, and preserve existing state-machine ownership.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/coding-run.ts
  - shared/product-semantics.ts
  - src/pages/Chat/execution-projection.ts
  - src/pages/Chat/index.tsx
  - src/components/assistant-render/CodingRunEvidence.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - tests/unit/coding-run.test.ts
  - tests/unit/execution-projection.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - tests/e2e/task-loop-panel.spec.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - harness/specs/tasks/coding-run-projection-export.md
  - harness/specs/fixtures/tf0377-coding-run-projection/**
---

# TF-0377 CodingRun Read-Only Projection and JSONL Export

## Objective

Use the TF-0376 association contract to project ordinary Chat and explicit
Task Loop facts into the same read-only CodingRun vocabulary. Display an
exportable JSONL rendering in the existing turn summary and Task Loop result
surfaces without introducing a persistence store or a second state machine.

## Scope

- Ordinary Chat cards include a CodingRun view only when their context can be
  supplied by existing owners; a missing workspace or run remains missing.
- Task Loop results map their existing lifecycle, evidence gate, tests and trace
  fields into the shared view. A missing evidence gate remains unavailable.
- JSONL includes the CodingRun record plus explicit `loop`, `test` and
  `verification` events. The serializer is display-only and does not write files.
- Chat evidence is shown inside the existing turn summary disclosure and Task
  Loop evidence inside the existing result card.
- Renderer uses existing local projection/serialization only; no new direct IPC,
  no new host route and no renderer file-system access is added.
- Existing Gateway, Task Ledger, Task Loop, Mission, ClawGraph and trace owners
  remain unchanged.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm run i18n:lint` passes.
- `pnpm exec vitest run tests/unit/coding-run.test.ts tests/unit/execution-projection.test.ts` passes.
- `pnpm run test:e2e:run tests/e2e/chat-task-visualizer.spec.ts --grep "renders team orchestration"` passes under Node 24.16.0.
- `pnpm run test:e2e:run tests/e2e/task-loop-panel.spec.ts` passes under Node 24.16.0.
- `pnpm harness validate --spec harness/specs/tasks/coding-run-projection-export.md` passes.
- `git diff --check` passes.
- Missing relations produce null/empty or warning output; no scope, lineage or
  completion is inferred from a session. No persistence, new route,
  state-machine change or downstream TF-0378 implementation is included.

## Notes

The ordinary Chat projection is bounded to the active Chat owner’s existing
workspace and run fields. The Task Loop projection is bounded to the result the
panel already owns. Receipts are agent-driven; no real-human evidence is claimed.
