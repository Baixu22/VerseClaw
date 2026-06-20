---
id: knowledge-chat-context-application
title: Knowledge context in Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make Knowledge Hub usable from the Chat composer by letting users search, select, and send explicit read-only knowledge references with a message.
touchedAreas:
  - shared/host-api/contract.ts
  - shared/chat/types.ts
  - src/pages/Chat/**
  - src/stores/chat.ts
  - src/stores/chat/**
  - electron/services/chat-api.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/e2e/knowledge-hub.spec.ts
expectedUserBehavior:
  - Users can search wiki knowledge from the Chat composer without leaving the conversation.
  - Users can attach selected knowledge pages as visible chips before sending.
  - Selected references are sent as read-only metadata so the runtime can prefer knowledge.get for those pages.
  - Selecting knowledge does not grant write, apply, update, archive, delete, or merge capability.
  - The optimistic user message shows which knowledge references were attached to the turn.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-target-routing.test.ts
  - tests/e2e/knowledge-hub.spec.ts
acceptance:
  - Renderer calls knowledge.search and recordKnowledgeReference only through src/lib/host-api.ts.
  - ChatSendWithMediaPayload can carry knowledgeReferences, and Main injects them only as untrusted read-only metadata.
  - knowledgeReferences do not cause wiki.apply, applyDraft, applyReviewedChange, delete, archive, or proposal apply.
  - Chat visible metadata cleanup still hides injected metadata while preserving user-visible reference chips.
  - The UI remains a compact composer affordance, not a duplicate Knowledge page or Markdown editor.
docs:
  required: true
---

This task improves the practical Chat-side Knowledge Hub application loop: find relevant knowledge, attach it to a turn, and make the runtime read it explicitly while preserving the user-confirmed governance boundary.
