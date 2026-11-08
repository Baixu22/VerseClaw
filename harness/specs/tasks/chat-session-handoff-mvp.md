---
lifecycleStatus: archived
id: chat-session-handoff-mvp
title: Chat session handoff MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a preview-first handoff action that prepares a deterministic continuation draft for a fresh workspace-scoped Chat session through typed Host API boundaries.
touchedAreas:
  - harness/specs/tasks/chat-session-handoff-mvp.md
  - shared/host-api/contract.ts
  - shared/types/long-task-control.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
  - src/lib/workspace-session.ts
  - src/pages/Chat/**
  - shared/i18n/locales
  - tests/unit/**
  - tests/e2e/**
expectedUserBehavior:
  - Users can open a handoff preview from Chat session controls or the composer context controls.
  - The preview shows an editable deterministic draft built from recent transcript, Task Ledger, git status, and recent run/trace/error context when available.
  - Creating the handoff confirms the runtime child and source, then submits the reviewed draft with a persistent first-send identity; failures retain the draft and unknown results are reconciled before retry.
  - Preparing a handoff is read-only; Task Ledger is linked only after the user confirms creation.
  - Handoff creation is disabled while the active session is running or streaming.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts tests/unit/long-task-control.test.ts
  - pnpm exec playwright test tests/e2e/chat-session-handoff.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer uses hostApi.sessions.prepareHandoff and does not read transcript files or call Gateway directly.
  - Main prepares the handoff with best-effort source warnings and no model call.
  - New handoff sessions are created through existing workspace session persistence with draftInput populated.
  - Full locale coverage is added for visible handoff UI strings.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Handoff creates a reviewed continuation prompt, confirms the runtime child and deliberately sends the first turn. Operation and delivery recovery follow `session-handoff-recovery.md`.
