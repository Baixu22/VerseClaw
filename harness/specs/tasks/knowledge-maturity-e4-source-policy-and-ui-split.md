---
lifecycleStatus: active
id: knowledge-maturity-e4-source-policy-and-ui-split
title: Knowledge maturity E4 cohort, source policy, and surface split
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the knowledge maturity gap by adding agent-driven E4 task-cohort evidence, opt-in Runtime Lessons routing, a real embedding provider for SourceSet semantic retrieval, and modular Host API/Knowledge UI boundaries.
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - shared/host-api/contract.ts
  - src/lib/host-api/knowledge/**
  - electron/services/knowledge-api.ts
  - electron/services/knowledge-embedding-provider.ts
  - src/pages/Knowledge/**
  - src/pages/Chat/ChatInput.tsx
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/knowledge.json
  - openclaw_runtime/extensions/memory-wiki/**
  - tests/fixtures/knowledge-e4-cohort/**
  - scripts/contract-check.mjs
  - scripts/contract-check.d.mts
  - scripts/knowledge-e4-cohort.mts
  - tests/unit/contract-check.test.ts
  - docs/dev/knowledge-system-unification/evidence/KS-E4-REAL-TASK-COHORTS.md
  - docs/dev/knowledge-system-unification/evidence/KS-E4-REAL-TASK-COHORTS.json
  - docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md
  - docs/dev/runtime-control-planes.md
  - docs/enhancements/knowledge-persistence/README.md
  - docs/enhancements/knowledge-persistence/04-phased-implementation-and-acceptance.md
  - harness/specs/tasks/knowledge-maturity-e4-source-policy-and-ui-split.md
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-ux-cdp.spec.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-host-api-split.test.ts
  - tests/unit/memory-wiki-agent-apply-gate.test.ts
expectedUserBehavior:
  - Chat can opt in to Runtime Lessons as an explicit, visible source policy without default injection.
  - Runtime Lessons candidates expose structured provenance in Knowledge Preflight.
  - SourceSet answers can opt in to a real semantic provider while lexical fallback remains available.
  - Knowledge UI is split into Library, Review Queue, Runtime Lessons, Governance, and SourceSet/Studio module boundaries.
  - Ordinary agents cannot call wiki_apply by default; the operator must explicitly enable the tool.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/knowledge-api.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/e2e/knowledge-hub.spec.ts
acceptance:
  - E4 cohort evidence records explicit refs, automatic retrieval, and SEKB retrieval outcomes for real repository tasks.
  - routeContext remains default-off for Runtime Lessons and returns visible provenance when opted in.
  - SourceSet semantic lane uses a real provider when configured and falls back to lexical ranking when unavailable.
  - Host API client is split into library, routing, inbox, drafts, proposals, steward, runtime lessons, source set, provenance, and watched-directory modules.
  - Knowledge UI has separate Library, Review Queue, Runtime Lessons, Governance, and SourceSet/Studio module files.
  - wiki_apply is not registered to ordinary agents unless tools.allowAgentApply is explicitly true.
docs:
  required: true
---

This task closes the knowledge maturity gap without changing product locks or promoting any surface to GA. It keeps every new source explicit and observable, preserves lexical fallback, and records E4 evidence as agent-driven rather than real-human evidence.

## Boundaries

- Runtime Lessons must remain opt-in in `routeContext`; default requests must not inject SEKB principles.
- SourceSet semantic retrieval must remain opt-in; lexical ranking remains the fallback when the provider is unavailable.
- The E4 cohort evidence must not claim real-human usefulness, E5 soak, product approval, or default-on promotion.
- `wiki_apply` must stay gated behind an explicit operator configuration.
- The Host API and UI split must not create a second knowledge authority, a second context service, or a new durable write path.
