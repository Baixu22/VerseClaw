---
id: knowledge-hub-mvp
title: Knowledge Hub MVP over memory-wiki
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a Verse Claw Knowledge Hub that wraps OpenClaw memory-wiki through the existing host API boundary.
touchedAreas:
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/knowledge-api.ts
  - electron/services/chat-api.ts
  - src/pages/Knowledge/**
  - src/pages/Chat/**
  - src/stores/chat/**
expectedUserBehavior:
  - Users can initialize, import bounded local files/folders, search, inspect, compile, lint, and apply confirmed drafts from the Knowledge page.
  - Chat sends carry an optional knowledgeScope through the typed host API without visible metadata leakage.
  - Saving a chat session to Knowledge opens an editable draft and writes only after explicit confirmation.
  - Obsidian remains optional; default setup uses an isolated Verse Claw-managed native wiki.
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
  - Renderer uses src/lib/host-api.ts for Knowledge calls and does not call Gateway endpoints directly.
  - Directory import is bounded to text-like files and calls wiki.ingest per file.
  - Config patch enables plugins.entries.memory-wiki without replacing unrelated plugin entries.
  - Session-derived knowledge is applied through wiki.apply only after an editable confirmation draft.
docs:
  required: true
---

Knowledge Hub MVP is a thin Verse Claw product layer over OpenClaw memory-wiki/memory-core, not a new RAG stack.
