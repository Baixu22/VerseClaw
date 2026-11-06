---
lifecycleStatus: active
id: knowledge-source-set-read-governance
title: Preserve owner evidence through Source Set answers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Route selected-source answers and Studio drafts through one existing SourceSet admission path, preserve owner metadata and version pins, and disclose excerpt-only answer limitations without a fabricated confidence score.
diffBase: bfcf57616b361a12845014b3f054b95e31c4021c
touchedAreas:
  - electron/services/knowledge-api.ts
  - electron/services/knowledge-source-set-answer.ts
  - shared/host-api/contract.ts
  - src/lib/knowledge-librarian.ts
  - src/pages/Knowledge/KnowledgeAssistant.tsx
  - src/pages/Chat/KnowledgeChat.tsx
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-source-set-answer.test.ts
  - tests/unit/knowledge-chat.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/modules/knowledge-base.md
  - harness/specs/rules/knowledge-source-set-read-admission.md
  - harness/specs/tasks/knowledge-source-set-read-governance.md
  - harness/specs/fixtures/knowledge-source-set-read-governance/**
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-source-set-answer.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-chat.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
expectedUserBehavior:
  - Selecting a file is a retrieval intent and does not override its status, permissions, sensitivity, or revision.
  - Both lexical and opt-in semantic answers omit rejected source text and explain unavailable sources.
  - Readable selected sources produce explicitly partial excerpt responses until an actual synthesis and citation verification path exists.
  - Source Set responses and Studio drafts do not assign a numeric answer confidence to template excerpts.
acceptance:
  - The real Host answer and Studio handlers reuse one SourceSet materialization and admission helper in both semantic modes.
  - Owner status, revision, digest, ACL, sensitivity, scope, and freshness are retained when supplied; unknown explicit policy values fail closed.
  - A source with missing or empty content cannot be replaced with a title or lookup and claimed as evidence.
  - Explicit revision and digest pins survive Source Set persistence and fail closed on a mismatch.
  - Rejected sources are never restored as a fallback, including when every selected source is rejected or semantic embedding fails.
  - Returned citations bind owner, canonical subject, revision, and the digest of the supplied read range; truncation and structured conflicts are disclosed.
  - Excerpt-only responses are partial, omit confidence, and leave durable changes as reviewable drafts.
  - Agent-driven focused Host and Electron evidence is retained on disk with exact command exits and scoped source hashes.
docs:
  required: true
---

This is the first delivery in the knowledge review follow-up. The local Task
Forest groups the seven reviewed gaps into three phases: source reliability
(read admission, local synchronization), answering and review (Librarian QA,
Chinese/long-document retrieval, version-bound Steward review), and connections
and effectiveness (one continuous connector, representative agent-run evaluation).
Only read admission is implemented in this change.

SourceSet remains a derived report. Reuse its policy and conflict rules; do not
add a new knowledge authority, database, review queue, agent fleet, or write path.
The existing semantic provider remains opt-in. Legacy wiki results without an
explicit status retain the owner's active-vault compatibility behavior; absent
trust defaults to advisory, absent freshness is unknown, and a missing revision
is labelled by the supplied content hash. None of these defaults claims approval.

Unstructured semantic contradiction detection, model QA, multi-turn context,
directory synchronization, and connector work are subsequent deliveries. A
partial excerpt response does not claim that those capabilities were verified.
All acceptance actors are agents; no real-human attribution or publisher input
is an acceptance prerequisite. Product locks and frozen defaults are unchanged.
