---
lifecycleStatus: active
id: unified-effect-admission
title: Compose task, session and checkout ownership at actual tool effects
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: dbe8f3e5c
intent: Complete TF-0865 by combining the existing task claim, session admission, coordinator binding and WorktreeService writer at the managed effect boundary, retaining authoritative receipts for recovery.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - autonomy-session-task-scope-boundary
  - runtime-lifecycle-governance-boundary
  - disk-temp-policy
  - docs-sync
  - comms-regression
touchedAreas:
  - shared/session-task-scope.ts
  - shared/checkout-ownership.ts
  - shared/task-system/**
  - shared/types/workspace.ts
  - electron/services/workspaces-api.ts
  - electron/services/task-system-service.ts
  - electron/gateway/session-task-scope-bridge.ts
  - electron/gateway/process-launcher.ts
  - openclaw_runtime/src/state/execution-state-db.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-reservation.ts
  - openclaw_runtime/src/agents/session-task-scope.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-registry.ts
  - openclaw_runtime/src/agents/worktree-writer.ts
  - openclaw_runtime/src/agents/execution-domain.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/execution-checkout-admission.ts
  - openclaw_runtime/src/agents/execution-checkout-tools.ts
  - openclaw_runtime/src/agents/persistent-task-delegation.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/gateway/server-methods/tasks.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/agents/tools/mission-loop-tool.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts
  - openclaw_runtime/src/gateway/server-methods/session-task-scope.ts
  - openclaw_runtime/src/infra/agent-events.ts
  - tests/unit/unified-effect-admission.test.ts
  - tests/unit/unified-task-authority.test.ts
  - tests/unit/durable-task-authority-access.test.ts
  - tests/unit/fixtures/unified-effect-worker.mts
  - tests/unit/session-task-scope-bridge.test.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/gateway-process-launcher-env.test.ts
  - tests/unit/mission-control-loop.test.ts
  - tests/e2e/unified-effect-admission.spec.ts
  - vitest.unified-effect.config.ts
  - harness/specs/tasks/unified-effect-admission.md
  - harness/specs/guides/checkout-writer-ownership.md
  - harness/specs/guides/unified-concurrent-development-management.md
  - harness/specs/fixtures/unified-effect-admission/**
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - A managed task can write only through its current session and execution binding with an exclusive checkout writer.
  - Independent checkouts can execute concurrently; conflicting ownership returns the existing owner and a recoverable wait or refusal.
  - Unknown effects and running processes retain checkout ownership until their existing owners supply settlement facts.
acceptance:
  - Two executions cannot hold the same task across checkouts; two tasks cannot concurrently write the same native checkout; independent checkouts can proceed.
  - Old session generation, task epoch, binding revision and checkout incarnation are rejected at actual wrapped and raw tool boundaries before filesystem effects.
  - Expiry never reallocates a writer; drain blocks new effects; unused reservations can be compensated idempotently and unresolved effects remain retained.
  - Explicit delegation and handoff preserve task fencing while checkout transfer waits for authoritative effect and process settlement; coordinator pause semantics retain the existing admitted-run contract.
  - Managed Mission execution references the existing task contract revision and claim epoch; TaskSystemStore remains the acceptance owner.
  - Registered clone execution resolves the declared task authority and rejects unavailable or replaced authority; no remote-name inference or copied task database is introduced.
  - External editors and ungoverned commands remain explicitly outside enforcement; existing local file locks continue their own serialization.
  - Tests read back actual files and receipts for concurrent processes, old identity, missing ownership, failed reservation, unknown outcome and recovery; existing A4 regressions remain passing.
  - Frozen product defaults remain unchanged; the managed pilot path and its rollback are explicit and executable.
requiredTests:
  - pnpm exec vitest run --config vitest.unified-effect.config.ts
  - pnpm exec vitest run --config vitest.checkout-writer.config.ts
  - pnpm exec vitest run tests/unit/session-task-scope-completion.test.ts tests/unit/session-task-scope-bridge.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/unified-effect-admission.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/unified-effect-admission.md
  - pnpm harness run --spec harness/specs/tasks/unified-effect-admission.md --dry-run
docs:
  required: true
  files:
    - harness/specs/guides/checkout-writer-ownership.md
    - harness/specs/guides/unified-concurrent-development-management.md
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

Task responsibility, session lifecycle, checkout exclusivity and capacity retain
their existing owners. The composition is one effect admission path, not another
scheduler or recovery authority. Session migration remains with TF-0866 and the
remaining UI acceptance criteria stay with TF-0658–TF-0662.
