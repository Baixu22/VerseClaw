---
lifecycleStatus: active
id: session-family-navigation
title: Connect project entry, session families and persistent task lists
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 08fa97bf3
intent: Make the existing project/session/task owners navigable without losing drafts or reading positions.
ownedPaths:
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/long-session-delegation-receipt.ts
  - src/components/chat/SessionDelegationStatus.tsx
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/components/file-preview/WorkspaceSubagentPanel.tsx
  - tests/unit/long-session-delegation-admission.test.ts
  - tests/unit/session-delegation-status.test.tsx
  - tests/unit/workspace-agents-panel-failure.test.tsx
  - tests/unit/session-chain-panels.test.tsx
  - tests/e2e/session-delegation-capacity.spec.ts
  - electron/gateway/chat-runtime-events.ts
  - electron/gateway/event-dispatch.ts
  - electron/gateway/manager.ts
  - electron/services/workspaces-api.ts
  - electron/main/ipc-handlers.ts
  - shared/host-events/contract.ts
  - src/lib/host-events.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - tests/unit/chat-startup-hydration.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - vite.config.ts
  - src/App.tsx
  - src/pages/Projects/**
  - src/pages/Chat/index.tsx
  - src/pages/Chat/use-session-reading-position.ts
  - src/hooks/use-stick-to-bottom-instant.ts
  - src/hooks/use-message-viewport.ts
  - tests/unit/chat-viewport.test.tsx
  - src/pages/TaskLedger/index.tsx
  - src/pages/TaskLedger/ManagedTasks.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/chat/SessionFamilyNavigation.tsx
  - src/components/task-ledger/TaskLedgerSummaryPanel.tsx
  - src/lib/workspace-session.ts
  - src/stores/workspaces.ts
  - tests/unit/workspaces-store.test.ts
  - shared/types/workspace.ts
  - src/styles/codex-sidebar.css
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/taskLedger.json
  - tests/unit/session-folder-tree.test.tsx
  - tests/unit/session-family-navigation.test.tsx
  - tests/unit/session-reading-scroll-owner.test.tsx
  - tests/e2e/session-task-reading-navigation.spec.ts
  - tests/e2e/session-task-state-guidance.spec.ts
  - tests/unit/session-task-state-guidance.test.tsx
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/project-agent-entry.spec.ts
  - harness/specs/tasks/session-family-navigation.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/fixtures/session-family-navigation/**
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/long-session-delegation-receipt.ts
  - electron/services/workspaces-api.ts
  - electron/main/ipc-handlers.ts
  - shared/host-events/contract.ts
  - electron/gateway/manager.ts
  - electron/gateway/chat-runtime-events.ts
  - electron/gateway/event-dispatch.ts
  - vite.config.ts
  - src/**
  - shared/types/workspace.ts
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/**
  - harness/specs/tasks/session-family-navigation.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - renderer-main-boundary
  - session-derivation-ui-contract
  - sidebar-session-row-controls
  - i18n-locale-coverage
  - ui-motion-material-system
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Project names enter their explicitly bound coordinator; disclosure buttons only fold the project.
  - Session families expand on demand with bounded indentation and keyboard controls.
  - The source and descendants remain accessible and each session keeps its draft and generation-bound reading position.
  - Persistent task lists distinguish empty, unavailable and stale scope; task navigation carries workspace and session.
acceptance:
  - Reuse Chat, Task Ledger and existing resource/role panels with explicit project/session scope.
  - Keep time ordering flat and project/workstream assignments unchanged by family presentation.
  - Cover Light/Dark, 1280x800 and 960x800, sidebar collapsed and keyboard navigation in Electron.
  - Retain four-locale copy, full UI journey tests and candidate-bound agent evidence.
requiredTests:
  - pnpm exec vitest run tests/unit/long-session-delegation-admission.test.ts tests/unit/session-delegation-status.test.tsx tests/unit/workspace-agents-panel-failure.test.tsx tests/unit/session-chain-panels.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/session-delegation-capacity.spec.ts --workers=1
  - pnpm run build:runtime
  - pnpm exec vitest run tests/unit/session-task-state-guidance.test.tsx --maxWorkers=1
  - pnpm exec playwright test tests/e2e/session-task-state-guidance.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/gateway-events.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/gateway-event-dispatch.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/session-reading-scroll-owner.test.tsx tests/unit/chat-viewport.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/session-task-reading-navigation.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/session-family-navigation.test.tsx tests/unit/session-folder-tree.test.tsx tests/unit/session-family-read-model.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/session-derivation-ui.spec.ts tests/e2e/project-agent-entry.spec.ts --workers=1
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm harness validate --spec harness/specs/tasks/session-family-navigation.md
  - pnpm harness run --spec harness/specs/tasks/session-family-navigation.md --dry-run
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/modules/multi-agent-and-tasks.md
---

This U2 slice consumes U1's read model and the A4 task owner. Fork/Handoff durable
creation, delegation outcomes and lifecycle controls continue in U3–U5.
