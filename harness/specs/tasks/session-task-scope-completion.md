---
lifecycleStatus: active
id: session-task-scope-completion
title: Complete automatic task scope and single writer admission
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c0868c76f
intent: Admit the first effect through the existing Workspace and Task Ledger owners, retaining explicit session generation and one writer per business task.
ownedPaths:
  - shared/session-task-scope.ts
  - shared/task-system/identity.ts
  - shared/task-system/store.ts
  - shared/types/workspace.ts
  - electron/services/workspaces-api.ts
  - electron/services/task-system-service.ts
  - electron/services/task-ledger-service.ts
  - electron/services/cron-api.ts
  - electron/services/sessions-api.ts
  - electron/services/git-api.ts
  - electron/gateway/session-task-scope-bridge.ts
  - electron/gateway/ws-client.ts
  - electron/gateway/process-launcher.ts
  - electron/main/ipc-handlers.ts
  - openclaw_runtime/src/agents/session-task-scope.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tool-mutation.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run-state.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/runs.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/runs.task-scope.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/cron/isolated-agent/run-executor.ts
  - openclaw_runtime/src/cron/isolated-agent/run-runid-canonical.test.ts
  - openclaw_runtime/src/cron/isolated-agent/run.test-harness.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/subagent-registry-run-manager.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods/session-task-scope.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-broadcast.ts
  - openclaw_runtime/src/infra/agent-events.ts
  - openclaw_runtime/packages/gateway-protocol/src/client-info.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/unit/session-task-scope-bridge.test.ts
  - tests/unit/cron-api-browser-automation.test.ts
  - tests/unit/long-session-coordinator-binding.test.ts
  - harness/specs/tasks/session-task-scope-completion.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/fixtures/session-task-scope-completion/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - shared/**
  - electron/**
  - openclaw_runtime/**
  - tests/unit/**
  - harness/specs/tasks/session-task-scope-completion.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/fixtures/session-task-scope-completion/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - autonomy-session-task-scope-boundary
  - comms-regression
  - docs-sync
  - repository-artifact-retention
  - durable-task-system-boundary
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Discussion and known pure reads leave the business task container empty.
  - Execution intent creates or selects one complete contract through task_control.start; first-effect admission consumes its TaskID and writer epoch.
  - Existing task state is preserved; unknown tools require admission and never imply read-only behavior.
  - Invalid scope, stale generation, paused ownership, old writer tokens and competing live writers reject before effects.
  - Fork receives task references without a writer; handoff fences the source and grants a fresh child writer only after quiescence.
acceptance:
  - Ten discussion turns create no business tasks; an explicit execution establishes one idempotent contract and first-effect admission preserves that task and one session link.
  - Task identity comes from explicit links and stable run identity, never a title or an external completion reference.
  - Recheck the live run tuple and current binding at every effect; a task cannot switch during a run.
  - Claims remain until actual runtime quiescence; admission completion, cache expiry and elapsed time cannot release them.
  - Direct embedded schedules use their actual run handle and recorded workspace; coordinator-owned schedules reject stale parent bindings and receive independent tasks and writers.
  - Bridge results are tied to a single backend connection, request and run tuple; timeout, cancellation and stale results fail closed.
  - Evidence is bound to a candidate and records agent actor, commands, exits, counts, hashes and negative cases.
requiredTests:
  - pnpm --dir openclaw_runtime test src/agents/tool-mutation.test.ts src/agents/embedded-agent-runner/runs.task-scope.test.ts src/cron/isolated-agent/run-runid-canonical.test.ts
  - pnpm exec vitest run tests/unit/session-task-scope-completion.test.ts tests/unit/session-task-scope-bridge.test.ts tests/unit/session-task-scope.test.ts tests/unit/long-session-coordinator-binding.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-task-scope-completion.md
  - pnpm harness run --spec harness/specs/tasks/session-task-scope-completion.md --dry-run
docs:
  required: true
  files:
    - docs/modules/multi-agent-and-tasks.md
---

This is the remaining A4 implementation. U1–U6 retain their complete UI and recovery
acceptance contracts and follow sequentially on this candidate. The bridge adds task
admission to the existing tool boundary; permission approval and task completion keep
their current owners.
