---
lifecycleStatus: archived
id: runtime-approval-bridge
title: In-app runtime exec-approval bridge
scenario: gateway-backend-communication
taskType: runtime-bridge
# Pinned to the commit this increment started from: the shared branch diverged from
# origin/main long ago, so the default diff base would report the whole branch.
diffBase: fc16faeee71c8b9fc803d7b7d7b6c2a00e0f6f4e
intent: Give ClawX an in-app entry point for the runtime exec-approval boundary so a gated command can be answered from the app instead of hanging until the session is abandoned.
touchedAreas:
  - .agent-workbench/task-forest/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/runtime-approval-bridge.md
  - shared/host-events/contract.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - electron/gateway/event-dispatch.ts
  - electron/gateway/manager.ts
  - electron/main/index.ts
  - electron/main/ipc-handlers.ts
  - electron/services/runtime-approvals-api.ts
  - electron/services/workspace-permissions.ts
  - src/App.tsx
  - src/components/runtime-approvals/RuntimeApprovalPrompt.tsx
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/runtime-approval-bridge.test.ts
  - tests/unit/runtime-approval-prompt.test.tsx
  - tests/e2e/runtime-approval-bridge.spec.ts
expectedUserBehavior:
  - When the runtime gates a command, an app-level prompt shows the command and the working directory instead of leaving the turn silently waiting.
  - The prompt offers only the decisions the runtime listed for that request, and sends exactly one of them back.
  - A rejected decision keeps the prompt open and shows the runtime's reason; a decision taken elsewhere closes it.
  - Pending requests survive a renderer reload because the prompt seeds from the runtime's own pending list.
  - The bridge never decides on the user's behalf and never widens the decision vocabulary.
ownedPaths:
  - .agent-workbench/task-forest/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/runtime-approval-bridge.md
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - electron/gateway/event-dispatch.ts
  - electron/gateway/manager.ts
  - electron/main/index.ts
  - electron/main/ipc-handlers.ts
  - electron/services/runtime-approvals-api.ts
  - electron/services/workspace-permissions.ts
  - src/App.tsx
  - src/components/runtime-approvals/RuntimeApprovalPrompt.tsx
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/runtime-approval-bridge.test.ts
  - tests/unit/runtime-approval-prompt.test.tsx
  - tests/e2e/runtime-approval-bridge.spec.ts
# This spec's diffBase covers the whole session change set, which also carries three
# concerns that are not this bridge's ownership: the Agent Dev evidence refresh that clears
# the stale-evidence veto in `pnpm run harness:ci`, the six task specs repaired for
# pre-existing structural defects, and the harness CLI default-diff-base fix. They are
# declared as review-visible residuals instead of being claimed as owned coverage.
residualPaths:
  - harness/specs/tasks/a1-layered-isolation-pilot.md
  - harness/specs/tasks/a2-multi-agent-orchestration-pilot.md
  - harness/specs/tasks/a4-decision-quality-pilot.md
  - harness/specs/tasks/a6-long-running-persistence-pilot.md
  - harness/specs/tasks/knowledge-steward-semantic-pilot.md
  - harness/specs/tasks/stress-test-windows-concurrency-v1.md
  - harness/src/cli.mjs
  - harness/src/git.mjs
  - tests/unit/harness-git.test.ts
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-quality/report.json
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - host-events-fallback-policy
  - comms-regression
  - i18n-coverage
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/runtime-approval-bridge.md
  - pnpm exec vitest run tests/unit/runtime-approval-bridge.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/runtime-approval-prompt.test.tsx
  - pnpm contract:check
  - pnpm i18n:lint
  - pnpm run typecheck
  - pnpm run test:e2e tests/e2e/runtime-approval-bridge.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The Gateway's exec.approval.requested/resolved broadcasts reach the renderer through the host event contract; frames without an approval id are dropped.
  - runtimeApprovals.list and runtimeApprovals.resolve are declared in the host-api contract, registered in the core service registry, and reachable through the renderer facade.
  - resolve forwards only allow-once/allow-always/deny and fails closed without calling the Gateway for a missing id or an unknown decision.
  - The workspace permission gate keeps answering pending runtime approvals reachable in every permission mode while every other mutation stays blocked in readOnly.
  - An Electron e2e drives a pending approval through the prompt and asserts the resolve call and the resulting cleared prompt.
  - No product lock, default value, or frozen flag catalog changes; the three locks stay false.
docs:
  required: false
  note: The prompt is an entry point for an existing runtime boundary; the user-facing flow is documented in the task spec and covered by the e2e rather than the README feature tables.
---
