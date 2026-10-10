---
lifecycleStatus: archived
id: knowledge-hub-governance
title: Knowledge Hub role-first governance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep Knowledge Hub agent-native while enforcing read-only chat scope and user-confirmed knowledge writes.
touchedAreas:
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/knowledge-api.ts
  - electron/services/chat-api.ts
  - src/pages/Knowledge/**
  - src/pages/Chat/**
  - shared/i18n/locales/*/knowledge.json
  - shared/i18n/locales/*/chat.json
expectedUserBehavior:
  - Chat knowledge scope selects read corpus only: none, memory, wiki, or all.
  - Agents may search/get scoped knowledge, but scope never grants apply, update, merge, archive, or delete authority.
  - Save to Knowledge creates an editable pending draft and proposal; formal wiki writes require user review/apply.
  - Knowledge Steward can classify, tag, warn, and propose changes but has canApplyDirectly=false.
  - Obsidian absence does not block Knowledge Hub governance flows.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-api.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/chat-save-to-knowledge.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
acceptance:
  - Renderer calls knowledge through src/lib/host-api.ts and never directly calls Gateway wiki endpoints.
  - createDraft, listDrafts, updateDraft, reviewDraft, proposeChange, and stewardReview do not call wiki.apply.
  - applyReviewedChange calls wiki.apply only for approved create proposals backed by approved drafts.
  - Hidden chat metadata explicitly says knowledge scope is read-only and denies write/delete/archive/apply actions.
  - Modify, merge, archive, and delete proposals include target pages and required diff/reason details before user confirmation.
docs:
  required: true
---

Knowledge Hub governance is a Verse Claw Main/UI review layer over OpenClaw memory-wiki, not a new RAG stack or autonomous writer.
