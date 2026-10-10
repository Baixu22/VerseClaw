---
lifecycleStatus: archived
id: chat-work-mode-mvp
title: Chat work mode MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a Codex-style work mode layer to Chat without replacing existing workspace permissions or OpenClaw tool policy.
touchedAreas:
  - shared/types/work-mode.ts
  - shared/types/workspace.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/services/chat-api.ts
  - src/stores/chat.ts
  - src/stores/workspaces.ts
  - src/pages/Chat/**
  - src/components/chat/WorkModeSummaryPanel.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/work-mode.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/work-mode-summary-panel.test.tsx
  - tests/unit/workspaces-store.test.ts
  - tests/e2e/chat-work-mode.spec.ts
expectedUserBehavior:
  - Users can switch Chat between Plan, Build, Review, and Docs/Data modes from the composer.
  - Work mode selection persists per workspace session and restores with other session UI state.
  - Switching work mode does not automatically change workspace permission mode.
  - Chat sends carry the selected work mode through the typed host API.
  - Main-process chat send annotates runtime messages with untrusted work mode intent metadata only.
  - The mode summary panel explains the active mode and degrades gracefully when no docs/data runtime status is available.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - tests/unit/work-mode.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/work-mode-summary-panel.test.tsx
  - tests/unit/workspaces-store.test.ts
  - tests/unit/chat-target-routing.test.ts
  - tests/e2e/chat-work-mode.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Work mode uses existing WorkspacePermissionMode values for recommendations and does not add a real permission enum.
  - Renderer stores workMode in workspace session UI state and sends it through hostApi.chat.sendWithMedia.
  - Unknown workMode values are ignored or normalized before metadata injection.
  - Work mode metadata states intent, response style, recommended permission, default knowledge scope, state widgets, and tool bundle labels without claiming tool availability.
  - All new user-facing strings are covered in en, zh, ja, and ru chat locale files.
  - E2E verifies mode switching, persistence save, permission non-escalation, Docs/Data panel state, and chat payload workMode.
docs:
  required: true
---

The work mode MVP is a Verse Claw product/UI layer. It should guide agent behavior and user expectations while leaving actual permission, MCP, Gateway, and OpenClaw runtime tool decisions to their existing owners.
