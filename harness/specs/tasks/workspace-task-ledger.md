---
id: workspace-task-ledger
title: Workspace task ledger for long-running agent work
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a workspace-scoped, agent-neutral task ledger that persists long task structure, dependencies, review state, decisions, session links, and offline HTML exports through the typed Host API boundary.
touchedAreas:
  - shared/types/task-ledger.ts
  - shared/host-api/contract.ts
  - electron/services/task-ledger-*.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/pages/TaskLedger/**
  - src/components/task-ledger/**
  - src/pages/Chat/index.tsx
  - shared/i18n/locales
expectedUserBehavior:
  - Users can open Task Ledger from the sidebar and manage workspace-scoped task nodes.
  - The ledger stores append-only JSONL events and rebuilds a snapshot with tree, DAG, history, review, and session-link data.
  - Chat shows a compact task ledger summary when the active workspace has tracked nodes.
  - Export creates a single offline HTML file with tree, DAG, history, and review views.
  - Renderer code uses src/lib/host-api.ts; it does not directly invoke IPC or read ledger files.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/task-ledger-service.test.ts
  - pnpm exec playwright test tests/e2e/task-ledger.spec.ts
  - pnpm run typecheck
acceptance:
  - TaskNode, TaskEdge, TaskEvent, and TaskSnapshot are shared typed contracts.
  - appendEvents honors idempotency keys and snapshot projection skips damaged JSONL rows with warnings.
  - taskLedger Host API exposes snapshot, appendEvents, createNode, updateNode, addEdge, linkSession, requestReview, clearReview, and exportHtml.
  - The task ledger page provides Tree, DAG, History, and Review tabs.
  - Chat summary shows current goal plus active, blocked, review, and recent decision state without mutating the ledger.
docs:
  required: true
  note: Update README variants with the Task Ledger feature and offline export behavior.
---
