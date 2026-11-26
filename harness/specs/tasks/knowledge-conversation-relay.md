---
lifecycleStatus: active
id: knowledge-conversation-relay
title: Knowledge conversations and main chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Resume workspace-scoped Knowledge records from Chat and exchange selected turns with the originating main conversation.
touchedAreas:
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/**
  - src/components/knowledge-bot/**
  - src/components/assistant-render/UserMessageBubble.tsx
  - src/pages/Chat/**
  - src/pages/Knowledge/**
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - electron/services/gateway-api.ts
  - electron/services/knowledge-api.ts
  - electron/main/ipc-handlers.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/knowledge-chat.test.tsx
  - tests/unit/knowledge-bot.test.tsx
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-bot-mention.test.tsx
  - tests/e2e/knowledge-conversation-relay.spec.ts
  - tests/e2e/knowledge-bot-mention.spec.ts
  - tests/e2e/knowledge-bot.spec.ts
  - harness/specs/tasks/knowledge-conversation-relay.md
  - harness/specs/tasks/knowledge-bot-avatar.md
  - harness/specs/rules/knowledge-bot-runtime-state.md
  - harness/specs/scenarios/windows-ui-v2.md
  - docs/dev/knowledge-bot.md
  - README*.md
expectedUserBehavior:
  - Open a saved Knowledge conversation or ask about a selected main-chat reply.
  - Send a selected Knowledge question, answer and citations to the linked chat and open its transcript.
  - Mention the knowledge assistant in Chat to follow its current request or ask a question inline.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - knowledge-bot-runtime-state
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/knowledge-chat.test.tsx
  - pnpm exec vitest run tests/unit/knowledge-bot-mention.test.tsx
  - pnpm exec vitest run tests/unit/knowledge-api.test.ts -t "checks source answers"
  - pnpm run test:e2e:run tests/e2e/knowledge-conversation-relay.spec.ts
  - pnpm run test:e2e:run tests/e2e/knowledge-bot-mention.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Earlier records retain their workspace and source selection. Pending answers return to their originating record.
  - Home-to-Knowledge transfers are editable. Knowledge-to-home sends bind the destination and retain an acknowledgement across reloads.
  - Leading @knowledge or @知识库助手 with a question invokes the shared Knowledge request. A mention alone shows activity without issuing another request.
  - Observed search, source reads, answer generation and citation verification update the bot and its activity log through request-correlated Main events.
  - Both surfaces read the same request result. Switching pages retains pending work, unrelated request events have no effect, and completed results survive reload.
docs:
  required: true
---
