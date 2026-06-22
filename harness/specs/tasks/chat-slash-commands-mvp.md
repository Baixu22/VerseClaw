---
id: chat-slash-commands-mvp
title: Chat slash commands / quick actions MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a discoverable slash-command menu and lightweight dispatcher in the Chat composer while reusing existing Chat, session, navigation, and Task Ledger actions.
touchedAreas:
  - harness/specs/tasks/chat-slash-commands-mvp.md
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/**
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-slash-commands.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Typing `/` as the first composer token opens a keyboard-selectable command menu.
  - Users can discover review, CI fix, test writing, diff explanation, commit, PR summary, Mission Control, Task Ledger, compaction, and fork actions from the menu.
  - Review, mission, and prompt-style commands route through the normal Chat send path as intent prompts.
  - Ledger commands either open Task Ledger or create a task node through the existing typed Host API, then best-effort link the current session.
  - Compact and fork commands reuse existing Chat session controls and respect their disabled states.
  - Unknown commands do not send accidentally and show a friendly localized prompt.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/chat-slash-commands-mvp.md
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/chat-slash-commands.spec.ts
  - pnpm run typecheck
acceptance:
  - Renderer does not add direct IPC calls or direct Gateway HTTP/WebSocket calls.
  - Slash commands are defined in a typed registry with i18n-backed labels, descriptions, argument hints, and explicit strategies.
  - The menu supports filtering, Escape close, Enter selection, and arrow-key navigation.
  - At least `/review`, `/ledger`, `/mission`, and `/fork` have observable actions covered by Electron E2E.
  - New user-facing text has full en/zh/ja/ru locale coverage.
  - Narrow viewport layout keeps the menu above the composer without covering the input row.
docs:
  required: true
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md; update only if the user-facing workflow docs need the slash-command entry point.
---

This MVP is a discoverability and dispatcher layer. It must not implement new Code Review Center, Mission Control, Git, CI, or Gateway behavior.
