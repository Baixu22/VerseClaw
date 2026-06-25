---
id: knowledge-agent-routing-governance
title: Knowledge Hub agent routing and governance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add agent-assisted Knowledge Hub routing while keeping chat context read-only and knowledge writes user-confirmed.
touchedAreas:
  - shared/host-api/contract.ts
  - shared/types/workspace.ts
  - src/lib/host-api.ts
  - electron/services/knowledge-api.ts
  - electron/services/chat-api.ts
  - src/pages/Chat/**
  - src/pages/Settings/**
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/settings.json
expectedUserBehavior:
  - Knowledge invocation defaults to Suggest mode, where candidates are shown as optional chips and are not attached automatically.
  - Manual mode performs no background routeContext/search work.
  - Auto-read mode is opt-in and attaches at most a bounded set of fresh, high-confidence, non-contradicted read-only references.
  - knowledgeScope=none prevents router search regardless of invocation mode.
  - /steward-audit runs governanceAudit and opens Knowledge Governance without sending a chat prompt or writing wiki content.
  - Watched directories can be configured from Settings; new files default to review before ingest and never create syntheses automatically.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-api.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/chat-slash-commands.spec.ts
acceptance:
  - Renderer calls knowledge routing and watched-directory APIs only through src/lib/host-api.ts.
  - knowledge.routeContext calls only read/search methods and never calls wiki.apply, proposal apply, archive, delete, or update.
  - Hidden chat metadata includes knowledgeMode and continues to deny apply/update/delete/archive/merge.
  - Suggest chips require explicit user Attach before references enter the send payload.
  - Auto-read references are marked attachKind=auto and remain read-only.
  - /steward-audit produces governance data but does not create proposals or formal wiki writes.
  - Watched directory direct ingest, when enabled, uses wiki.ingest for sources only; review mode creates Inbox items.
docs:
  required: true
---

Knowledge Hub agent routing is a policy layer over existing memory-wiki search, not a new retrieval stack. It is allowed to help users notice relevant knowledge, but it must not seize prompt context by default or convert read access into write authority.
