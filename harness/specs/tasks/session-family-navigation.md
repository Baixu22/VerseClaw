---
lifecycleStatus: active
id: session-family-navigation
title: Connect project entry, session families and persistent task lists
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 95b876f27
intent: Make the existing project/session/task owners navigable without losing drafts or reading positions.
ownedPaths:
  - vite.config.ts
  - src/App.tsx
  - src/pages/Projects/**
  - src/pages/Chat/index.tsx
  - src/pages/Chat/use-session-reading-position.ts
  - src/pages/TaskLedger/index.tsx
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
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/project-agent-entry.spec.ts
  - harness/specs/tasks/session-family-navigation.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
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
    - docs/modules/multi-agent-and-tasks.md
---

This U2 slice consumes U1's read model and the A4 task owner. Fork/Handoff durable
creation, delegation outcomes and lifecycle controls continue in U3–U5.
