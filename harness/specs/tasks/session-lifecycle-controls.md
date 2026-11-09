---
lifecycleStatus: active
id: session-lifecycle-controls
title: Fence session lifecycle controls and preserve recoverable views
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c308b60e1
intent: Complete the existing session/task UI contract through owner-backed, generation-scoped results.
ownedPaths:
  - src/lib/host-api.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/components/chat/ResourceChip.tsx
  - src/stores/session-activity.ts
  - docs/dev/session-lifecycle-control-matrix.md
  - tests/unit/session-lifecycle-control-scope.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - harness/specs/tasks/session-lifecycle-controls.md
  - shared/i18n/locales/**/chat.json
  - docs/modules/multi-agent-and-tasks.md
  - electron/services/session-delete-gate.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - shared/chat/types.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/types/workspace.ts
  - src/components/chat/CheckpointsDialog.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Settings/sections/ArchivedSection.tsx
  - tests/e2e/session-context-recovery.spec.ts
  - tests/e2e/session-lifecycle-recovery.spec.ts
  - tests/e2e/session-worktree-storage.spec.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/r0-3-chat-abort-checkstuck.test.ts
  - tests/unit/session-delete-gate.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction.ts
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.queued.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction-range.handler.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.checkpoint-diff.test.ts
  - tests/unit/checkpoints-dialog.test.tsx
  - tests/unit/host-services.test.ts
  - electron/services/git-api.ts
  - electron/services/session-storage-api.ts
  - electron/services/task-system-service.ts
  - tests/unit/git-api.test.ts
  - tests/unit/session-storage-api.test.ts
  - tests/unit/ui-worktree-cleanup-conservative.test.ts
  - src/pages/Settings/sections/StorageSection.tsx
  - shared/i18n/locales/**/settings.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - shared/task-system/store.ts
  - tests/unit/durable-task-authority-access.test.ts
  - harness/specs/fixtures/session-lifecycle-recovery/**
  - tests/unit/session-lifecycle-tail.test.ts
  - tests/unit/long-session-lifecycle-barrier.test.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - electron/services/long-session-resource-reclamation.ts
touchedAreas:
  - src/lib/host-api.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/components/chat/ResourceChip.tsx
  - src/stores/session-activity.ts
  - docs/dev/session-lifecycle-control-matrix.md
  - tests/unit/session-lifecycle-control-scope.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - harness/specs/tasks/session-lifecycle-controls.md
  - shared/i18n/locales/**/chat.json
  - docs/modules/multi-agent-and-tasks.md
  - electron/services/session-delete-gate.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - shared/chat/types.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/types/workspace.ts
  - src/components/chat/CheckpointsDialog.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Settings/sections/ArchivedSection.tsx
  - tests/e2e/session-context-recovery.spec.ts
  - tests/e2e/session-lifecycle-recovery.spec.ts
  - tests/e2e/session-worktree-storage.spec.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/r0-3-chat-abort-checkstuck.test.ts
  - tests/unit/session-delete-gate.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction.ts
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.queued.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction-range.handler.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.checkpoint-diff.test.ts
  - tests/unit/checkpoints-dialog.test.tsx
  - tests/unit/host-services.test.ts
  - electron/services/git-api.ts
  - electron/services/session-storage-api.ts
  - electron/services/task-system-service.ts
  - tests/unit/git-api.test.ts
  - tests/unit/session-storage-api.test.ts
  - tests/unit/ui-worktree-cleanup-conservative.test.ts
  - src/pages/Settings/sections/StorageSection.tsx
  - shared/i18n/locales/**/settings.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - shared/task-system/store.ts
  - tests/unit/durable-task-authority-access.test.ts
  - harness/specs/fixtures/session-lifecycle-recovery/**
  - tests/unit/session-lifecycle-tail.test.ts
  - tests/unit/long-session-lifecycle-barrier.test.ts
  - tests/unit/r0-2-sessions-delete-fail.test.ts
  - electron/services/long-session-resource-reclamation.ts
requiredRules:
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Admission, actual execution, report delivery, task acceptance and parent continuation remain distinct.
  - Current session/workspace/generation scopes reject stale results and unavailable owner actions.
  - Read failures stay visible and preserve draft, transcript and evidence references.
acceptance:
  - Apply the complete U4 or U5 contract from session-derivation-ui-design and its Task Forest node.
  - Use canonical host actions and current owner receipts; do not infer task acceptance from text or a finished run.
  - Stop, pause, archive, delete and context restore retain their distinct scopes and recovery behavior.
  - Existing child sessions remain reachable after source archive/delete; no implicit subtree action is added.
  - Four-locale Electron journeys and focused negative tests identify the same candidate and agent actor.
requiredTests:
  - pnpm exec vitest run tests/unit/session-lifecycle-control-scope.test.ts tests/unit/session-delete-gate.test.ts tests/unit/checkout-writer-ownership.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/session-context-recovery.spec.ts tests/e2e/session-lifecycle-recovery.spec.ts tests/e2e/session-worktree-storage.spec.ts --workers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/session-derivation-ui.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/session-lifecycle-controls.md
  - pnpm harness run --spec harness/specs/tasks/session-lifecycle-controls.md --dry-run
docs:
  required: true
  files:
    - docs/modules/multi-agent-and-tasks.md
---

The original session UI contract remains the acceptance source. Its required cases
are retained in the aggregate journey inventory; this spec only narrows ownership.
