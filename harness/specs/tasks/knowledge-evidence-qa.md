---
lifecycleStatus: active
id: knowledge-evidence-qa
title: Answer knowledge questions using admitted evidence and checked citations
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Unify default Librarian and selected Source Set questions through Main, reuse model-only Gateway runs, bound conversation context, and validate source quotations before showing an answer.
diffBase: 3c72a9a262d704da7edcb6889bc1bf77bcc3f987
touchedAreas:
  - electron/services/knowledge*.ts
  - electron/main/index.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/*/knowledge.json
  - src/lib/knowledge-librarian.ts
  - src/lib/host-api/knowledge/**
  - src/pages/Chat/KnowledgeChat.tsx
  - src/pages/Knowledge/KnowledgeAssistant.tsx
  - tests/unit/knowledge*.test.*
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-bot.spec.ts
  - README*.md
  - docs/modules/knowledge-base.md
  - harness/specs/tasks/knowledge-*.md
  - harness/specs/rules/knowledge-*.md
  - harness/specs/fixtures/knowledge-*/**
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-evidence-qa.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-chat.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
expectedUserBehavior:
  - Default Librarian and selected-source questions use checked source quotations and bounded follow-up history.
  - Missing evidence, conflicts, incomplete reads and model failures remain visible without fabricated confidence.
acceptance:
  - Both default and selected-source chat use Host evidence admission before model inference.
  - Bounded history is untrusted context; each factual statement requires admitted source IDs and exact source quotations.
  - Missing evidence, conflicts, invalid citations and model failures are explicit and cannot become successful uncited answers.
  - Model-only requests have no tool or delivery authority and do not bypass review or apply.
  - Runtime and citation validation are exercised by agent-driven fixtures; real provider quality is measured separately.
docs:
  required: true
---

TF-0798 follows source synchronization. Reuse the configured Gateway model and
existing read-only SourceSet. Structured answer validation proves quote existence
and citation binding; it is not a general semantic entailment guarantee. A clean
model answer may be evidence-grounded only with complete, nonconflicting admitted
reads and checked references. Partial excerpts remain the fallback, with a visible
model status. Do not add agents, databases or direct renderer network calls.
