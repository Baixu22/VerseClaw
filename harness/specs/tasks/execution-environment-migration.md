---
lifecycleStatus: active
id: execution-environment-migration
title: Resume a logical session across execution checkouts without losing its task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 03164afd0
intent: Complete TF-0866 by recording a recoverable migration through existing Workspace bindings, session mutation journal, TaskSystemStore handoff and checkout ownership.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - runtime-lifecycle-governance-boundary
  - disk-temp-policy
  - docs-sync
  - comms-regression
  - i18n-locale-coverage
touchedAreas:
  - shared/types/execution-migration.ts
  - shared/types/workspace.ts
  - shared/host-api/contract.ts
  - shared/task-system/**
  - electron/services/workspaces-api.ts
  - electron/services/execution-migration.ts
  - electron/services/task-system-service.ts
  - openclaw_runtime/src/gateway/session-mutation-operation-journal.ts
  - openclaw_runtime/src/gateway/session-mutation-operation-journal.test.ts
  - openclaw_runtime/src/gateway/session-execution-migration.ts
  - openclaw_runtime/src/gateway/session-archive-service.ts
  - openclaw_runtime/src/plugins/session-entry-slot-keys.ts
  - openclaw_runtime/src/gateway/server-methods/session-task-scope.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/execution-task-guard.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/execution-checkout-tools.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/execution-checkout-admission.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - src/lib/host-api.ts
  - src/pages/Chat/**
  - src/i18n/index.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/execution-migration*.test.ts
  - tests/unit/execution-migration*.test.tsx
  - tests/unit/unified-task-authority.test.ts
  - tests/unit/unified-effect-admission.test.ts
  - tests/unit/i18n-language-order.test.ts
  - tests/unit/fixtures/execution-migration-worker.mts
  - tests/e2e/execution-migration.spec.ts
  - harness/specs/tasks/execution-environment-migration.md
  - harness/specs/scenarios/execution-environment-migration.md
  - harness/specs/fixtures/execution-environment-migration/**
  - docs/modules/sessions.md
  - docs/modules/multi-agent-and-tasks.md
  - docs/dev/session-lifecycle-control-matrix.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - An existing session and its task can continue in another verified checkout without re-entering the objective or copying the task database.
  - Interrupted migration resumes from its recorded operation, with source and target effects blocked until owners confirm the handoff.
acceptance:
  - Termination or lost replies after each durable step resume using the same operationId and preserve the objective, transcript and artifact references.
  - Source and target never have concurrent valid write authority; stale generation, epoch, binding and checkout credentials reject actual effects.
  - The receiving side reads the target contract revision, candidate/checkpoint, pending operations and resource settlement before publication; same ID with changed payload rejects.
  - Logical sessionKey stays constant while physical generation, run and task claim epoch retain separate identities; Fork/Handoff-to-new-chat is not used as environment migration.
  - Existing session mutation journal and Workspace operation records hold intent, fence/drain, target reservation, binding, readback and publication; recovery consumes original owner receipts.
  - Same-machine registered clones use the existing task authority route; no URL-based identity inference, copied SQLite task ledger or cross-machine service is introduced.
  - Existing Chat work entry exposes target selection and resume with four locales; closing/reopening the window keeps the original task and operation.
  - Automation drives all interaction and recovery proofs with actor/driven_by=agent; frozen product defaults and release state remain unchanged.
requiredTests:
  - pnpm exec vitest run tests/unit/execution-migration-process.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/execution-migration-control.test.tsx tests/unit/i18n-language-order.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/execution-migration.test.ts tests/unit/execution-migration-runtime.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run --config vitest.unified-effect.config.ts
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/execution-migration.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/execution-environment-migration.md
  - pnpm harness run --spec harness/specs/tasks/execution-environment-migration.md --dry-run
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/sessions.md
    - docs/modules/multi-agent-and-tasks.md
    - docs/dev/session-lifecycle-control-matrix.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

Migration composes the accepted task/session and checkout owners. Partial commits
remain recoverable and closed to new effects until the same operation is confirmed.
Existing RecoveryAuthority still decides uncertain tool outcomes. Task Forest is
development tracking and is not a product runtime dependency.
