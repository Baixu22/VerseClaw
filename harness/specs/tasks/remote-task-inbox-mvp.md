---
lifecycleStatus: archived
id: remote-task-inbox-mvp
title: Remote Task Inbox MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a local-first remote task inbox that can accept structured task envelopes, require approval for settings changes, execute safe whitelisted actions through Main-owned host services, and expose the workflow in the renderer without direct IPC or Gateway transport.
touchedAreas:
  - harness/specs/tasks/remote-task-inbox-mvp.md
  - shared/types/remote-tasks.ts
  - shared/host-api/contract.ts
  - electron/services/remote-tasks-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/pages/Inbox/**
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - shared/i18n/locales
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - tests/unit/remote-tasks-api.test.ts
  - tests/unit/inbox-store.test.ts
  - tests/e2e/remote-tasks.spec.ts
expectedUserBehavior:
  - Users can open a Remote Tasks inbox from the sidebar.
  - Users can create local test task envelopes for message, doctor, and settings patch actions.
  - Settings patch tasks start in a pending approval state and show a change preview before execution.
  - Executed tasks record status, timestamps, result summaries, and errors in a persistent local queue.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/remote-task-inbox-mvp.md
  - pnpm exec vitest run tests/unit/remote-tasks-api.test.ts tests/unit/inbox-store.test.ts
  - pnpm exec playwright test tests/e2e/remote-tasks.spec.ts
acceptance:
  - Renderer uses hostApi.remoteTasks only and adds no direct window.electron.ipcRenderer calls or direct Gateway HTTP/WebSocket calls.
  - The MVP supports message, doctor, and settingsPatch task kinds.
  - settingsPatch only allows a conservative whitelist of settings keys and never executes without explicit approval.
  - Task state is persisted in the app data directory and survives reload.
  - The UI uses i18n keys for all user-facing strings across en, zh, ja, and ru.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
