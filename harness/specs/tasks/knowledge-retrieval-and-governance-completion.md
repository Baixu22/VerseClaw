---
lifecycleStatus: active
id: knowledge-retrieval-and-governance-completion
title: Complete knowledge retrieval, evidence review and continuous source acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete the six remaining assessed knowledge gaps using existing admission, Inbox, GovernanceStore and model-only Gateway paths.
diffBase: 3c72a9a262d704da7edcb6889bc1bf77bcc3f987
touchedAreas:
  - electron/services/knowledge*.ts
  - electron/main/index.ts
  - openclaw_runtime/src/context-engine/source-set.ts
  - openclaw_runtime/src/runtime-core/memory-tokenization.ts
  - openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts
  - shared/host-api/**
  - shared/i18n/locales/*/knowledge.json
  - src/lib/host-api/**
  - src/lib/knowledge-librarian.ts
  - src/pages/Chat/KnowledgeChat.tsx
  - src/pages/Knowledge/KnowledgeAssistant.tsx
  - tests/unit/knowledge*.test.*
  - tests/e2e/knowledge*.spec.ts
  - scripts/knowledge-*.ts
  - scripts/run-knowledge-*.mjs
  - scripts/contract-check.mjs
  - package.json
  - README*.md
  - docs/modules/knowledge-base.md
  - harness/specs/tasks/knowledge-*.md
  - harness/specs/rules/knowledge-*.md
  - harness/specs/fixtures/knowledge-*/**
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-source-sync.test.ts
  - tests/unit/knowledge-evidence-qa.test.ts
  - tests/unit/knowledge-source-set-answer.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-chat.test.tsx
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/e2e/knowledge-hub.spec.ts
expectedUserBehavior:
  - Librarian answers and follow-ups cite only admitted source bytes, with visible missing evidence, conflicts and model fallback.
  - Long documents retain explicit read ranges; semantic cache reuse cannot cross provider or credential scopes.
  - Steward findings retain source versions and cannot overwrite a draft changed during review.
  - Public GitHub updates and withdrawals appear as agent-driven Inbox candidates and never apply automatically.
acceptance:
  - Chinese and English lexical retrieval have reproducible hits and abstention boundaries.
  - Bounded long-source continuation selects a relevant read window, discloses truncation and rejects owner version or policy changes.
  - Embeddings reuse a bounded content-addressed cache scoped to provider, endpoint, model and credential; failures are never cached.
  - Steward consumes admitted original evidence and effective reviewFocus, persists structured version-bound findings and refuses stale draft writes.
  - One explicit external continuous connector exercises stable identity, updates, withdrawals, ACL changes, retry and restart without direct Wiki writes.
  - Reproducible evaluation separates scripted runtime evidence from live provider calls and records quality, abstention, freshness and paired task outcomes.
docs:
  required: true
---

TF-0797 through TF-0802 are validated and closed in dependency order within the
explicitly requested continuation. Their implementation was retained in one
source candidate; that does not substitute for the individual evidence gates.
Frozen product defaults remain in force. All automated actors are
labelled agent-driven. Citation validation proves exact quote existence and
source/version binding, not universal semantic entailment. Accepted knowledge
still changes exclusively through reviewed apply. The connector is explicitly
identified in documentation; no unsupported SaaS connector is claimed.
