---
id: project-coordinator-closeout
title: TF-0678 Project verification, bounded repair and closeout
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 56130d2c6
intent: Connect the existing orchestration repair and integration path to independent verification of the submitted candidate and durable Task Ledger acceptance.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - autonomy-task-completion-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - .gitignore
  - AGENTS.md
  - shared/task-system/types.ts
  - shared/task-system/store.ts
  - shared/task-system/runtime.ts
  - shared/types/workspace.ts
  - electron/services/task-system-service.ts
  - electron/services/workspaces-api.ts
  - openclaw_runtime/src/agents/persistent-task-acceptance.ts
  - openclaw_runtime/src/agents/persistent-task-delegation.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/execution-checkout-tools.ts
  - openclaw_runtime/src/agents/execution-task-guard.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-spawn.test.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tool-mutation.test.ts
  - openclaw_runtime/src/agents/workspace.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/agent-tools.read.ts
  - openclaw_runtime/src/agents/sessions/tools/read.ts
  - openclaw_runtime/src/agents/sessions/tools/tool-contracts.ts
  - tests/unit/durable-task-acceptance.test.ts
  - tests/unit/durable-task-review.test.ts
  - tests/unit/durable-task-review-wiring.test.ts
  - tests/unit/durable-task-runtime.test.ts
  - tests/unit/durable-task-delegation.test.ts
  - tests/unit/autonomy-worktree-integration.test.ts
  - tests/unit/role-spawn.test.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/e2e/project-agent-loop.spec.ts
  - tests/e2e/project-closeout.spec.ts
  - harness/specs/tasks/project-coordinator-closeout.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/fixtures/autonomous-project-system/p4/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - The project coordinator repairs a failed check within the existing orchestration budget, verifies the integrated candidate and reports the accepted result without another user prompt.
  - An independent verifier reads the submitted candidate and its artifacts. Changed candidates, missing evidence and rejected reviews leave the task open.
  - The result identifies verified checks, remaining gaps and the next action; publishing remains a separate decision.
requiredTests:
  - node node_modules/vitest/vitest.mjs run --config vitest.task-system.config.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/autonomy-worktree-integration.test.ts --testNamePattern="repairs a failed worker check|verifies two real worker results"
  - node scripts/typecheck-agent-dev.mjs
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/project-closeout.spec.ts
acceptance:
  - Exercise a real file change, failing check, bounded repair, integration, fresh check and independent verifier, then read the final task and candidate from disk.
  - Bind verification to the submitted candidate, contract revision, writer epoch, coordinator generation and artifact hashes. A newer pending or failed review cannot fall back to an older pass.
  - Reject self-verification, stale or absent candidate artifacts, a changed submission, a mismatched verifier run and repair attempts beyond the existing orchestration budget.
  - Persist at most one repair in the task contract and event journal. Reopening or handing off a task cannot reset the repair count; retrying the same request does not consume it twice. Repair invalidates previous checks.
  - Independent review contracts require an explicit repair budget. Dispatch requires the parent's effective delegation permission and the read tool. A known admission refusal without a child identity permits a new request; an unknown result prevents replay.
  - Read Task Ledger and effect receipts to prove exactly one acceptance. Keep failures and source artifacts available for repair.
  - Record agent actors, source and candidate revisions, commands, exits, case counts and artifact hashes. Apply the development Task Forest proposal only after the same-candidate evidence passes.
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

P4 uses the general orchestration path and its existing bounded follow-up policy.
Task Ledger owns task completion; Registry owns verifier identity and terminal state;
the worktree owner owns integration. Task Forest records development progress through
its existing proposal, graph-hash, validation and export commands.
