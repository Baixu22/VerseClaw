---
id: knowledge-hub-vnext-orchestration
title: Knowledge Hub vNext orchestration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a lean Knowledge Inbox and provenance layer so Chat, agents, Task Ledger, ClawGraph, files, and OKF imports can feed governed knowledge without expanding into a new knowledge backend.
touchedAreas:
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/knowledge-api.ts
  - src/pages/Knowledge/**
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/knowledge-hub.spec.ts
expectedUserBehavior:
  - Knowledge Inbox holds user/agent/steward/session/task/file/OKF candidates outside the formal wiki until the user promotes or dismisses them.
  - Promoting an inbox item creates a normal editable KnowledgeDraft and optional proposal; it still does not call wiki.apply.
  - Provenance records source refs and read/reference events without mutating formal wiki pages.
  - Chat knowledge scope remains read-only and only grants search/get intent.
  - Knowledge Steward can review inbox/draft content and suggest tags/warnings/proposals, but cannot apply directly.
  - Mission reviewer `knowledge_draft` candidates land in Knowledge Inbox with rule-scored metadata and a stable `captureKey`; repeated captures reuse the existing Inbox item.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/knowledge-hub.spec.ts
acceptance:
  - Renderer calls inbox/provenance operations through src/lib/host-api.ts and never directly calls Gateway wiki endpoints.
  - createInboxItem, listInboxItems, updateInboxItem, dismissInboxItem, promoteInboxItemToDraft, recordKnowledgeReference, and getProvenance do not call wiki.apply.
  - createInboxItem is idempotent for automatic candidates carrying `metadata.captureKey`; duplicates return the existing Inbox item instead of creating another JSON file.
  - Inbox promotion creates an editable draft with preserved source refs, tags, type, creator, workspace, and warnings.
  - Inbox details display recommendation reason, score breakdown, source type labels, Mission `missionId`, `tick`, `outcome`, `temporality`, lifecycle `status`, and expandable `captureKey` audit details when metadata is present, while old or missing metadata falls back to reviewable defaults.
  - Provenance metadata is stored under knowledge/provenance and audit events are appended for create/promote/dismiss/reference flows.
  - The UI surfaces Inbox and provenance as governance metadata, not as a Markdown editor clone or alternate RAG stack.
docs:
  required: true
---

This task is the vNext orchestration layer for Knowledge Hub. It should deepen Verse Claw ecosystem coupling through governed inbox/provenance state while keeping memory-wiki as the only formal knowledge backend.

The v0.2 Knowledge Interaction step is an orchestration-alignment pass only: Mission candidates should show their recommendation, lifecycle status, Mission/tick/outcome context, capture key, score, and evidence in the existing Inbox review surface. It must not add ordinary Chat auto-capture, LLM scoring, GraphRAG, batch review, decay automation, or any automatic formal wiki write.

## Control-plane boundaries

- Rules are hard constraints owned by `AGENTS.md` and `harness/specs/**`; automatic memory or knowledge capture must never write Rules, including `AGENTS.md`, `harness/specs/**`, or `.clawx/rules/*.md`.
- Knowledge stores project facts, architecture rationale, failure lessons, and workflow lessons. Automatic candidates from chat, agents, files, Task Ledger, ClawGraph, or user corrections must land in Knowledge Inbox with `status: pending`, not as formal wiki pages or applied Knowledge proposals.
- Mission `knowledge_draft` capture must preserve `metadata.mvpVersion`, `recommendation`, `score`, `temporality`, `reason`, `missionId`, `tick`, `outcome`, `evidenceRefs`, and `captureKey`.
- Role Memory stores role experience, role preferences, and role-specific failure lessons through the runtime `memory.*` proposal flow. It must not be used as Project Rules.
- Task Ledger stores current long-task state, decisions, blockers, review nodes, and evidence. It can feed Knowledge Inbox candidates, but it is not a formal Knowledge or Rules writer.

Automatic capture may create Inbox items or Role Memory proposals only. Formal Knowledge writes require explicit user review/apply, and Rules changes require the project rules/harness workflow.
