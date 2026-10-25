---
id: model-capability-positioning-acceptance
title: Agent-driven model positioning and component closeout acceptance
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Verify 24 declared positioning scenarios against the production bounded prompt, observed owner permission decisions and recorded provider responses on a clean candidate.
touchedAreas:
  - tests/e2e/memory-surface.spec.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - harness/specs/tasks/model-capability-positioning-acceptance.md
  - shared/model-capability-profile.ts
  - shared/dcs/component-disposition-catalog.ts
  - tests/unit/model-capability-positioning-tf0507.test.ts
  - tests/unit/fixtures/model-capability-positioning-tf0507/**
  - scripts/model-capability-positioning.mts
  - scripts/verify-model-capability-positioning.py
  - docs/dev/component-graduation/TF-0507/**
  - docs/generated/catalogs/tools.md
  - docs/generated/catalogs/prod-flags.md
  - scripts/repository-artifacts.json
  - .gitignore
  - harness/specs/tasks/component-graduation-final-audit.md
  - scripts/component-graduation-final-audit.mts
  - shared/component-authority-manifest.ts
  - tests/unit/component-disposition-catalog.test.ts
  - docs/clawx-product-semantics.md
  - docs/dev/component-disposition-matrix-20261021.md
  - docs/dev/default-config-matrix.md
  - docs/dev/vtoken-retirement-decision.md
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts
  - docs/dev/component-graduation/TF-0508/**
  - docs/dev/versegit-product-integration/TF-0517/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - artifacts/capability-claims/status-table.json
  - artifacts/first-product-preview/FP-P1-08/forbidden-claims-scan.json
  - docs/dev/dcs-visible-production/RETIRED-SURFACES.md
  - scripts/render-component-disposition-matrix.mts
  - shared/capability-claims.ts
  - shared/dcs/prod-flags-control.ts
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/zh/settings.json
  - tests/fixtures/launch-contract-matrix.ts
  - tests/unit/capability-claims.test.ts
  - tests/unit/default-config-matrix.test.ts
  - tests/unit/first-product-claims.test.ts
  - tests/unit/model-capability-profile.test.ts
  - tests/unit/fixtures/component-graduation-tf0508/**
  - tests/unit/fixtures/model-capability-effective-state-tf0512/**
  - tests/unit/fixtures/model-positioning-tf0507/**
  - tests/unit/fixtures/product-semantics-tf0506/**
  - scripts/verify-versegit-product-integration.mjs
  - tests/unit/versegit-product-acceptance.test.ts
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/model-capability-positioning-tf0507.test.ts tests/unit/model-capability-profile.test.ts tests/unit/runtime-effective-capability.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
expectedUserBehavior:
  - Capability positioning includes available memory, applied knowledge and action restrictions within the existing reserved prompt budget.
  - The model cannot treat internal mechanisms, unapproved actions, stale knowledge or unverified runtime state as active product capabilities.
acceptance:
  - Preserve the POS-P0-A through POS-P2-H identities and eight scenario classes; freeze model, one repetition per row, source and scoring protocol before the acceptance run.
  - Use the production capability prompt as system input; do not add a test-only effective-state block or expected answers.
  - Compare structured model statements to the recorded effective profile and actual owner guard outputs, with no inferred denials or fixed success counters.
  - Cover pending approval, granted execution, revoked and expired grants, cross-scope rejection, unapplied and stale knowledge, and restart generation mismatch.
  - All 24 rows pass; false claims, missing listed enabled capabilities, internal product names and unauthorized effects are zero.
  - Recompute digests, response scores, source bindings and manifests from disk; reject mutated evidence.
  - Retain agent attribution, clean candidate identity, exact commands and limitations; never claim real-human or general model acceptance.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The 24 scenarios use controlled, agent-created owner facts and the actual runtime
profile builder and permission guard. Provider responses and the permitted echo
process are real observations. This does not measure an installed application's
approval UI, arbitrary shell commands, other providers or general availability.
Previous attempts remain in a private archive and do not become passing evidence.
The separate final component audit validates retained per-component evidence;
VerseGit closure uses its own report and proposal.
The listed final-audit paths belong to that same reviewed change set. They
reconcile the existing dispositions and source coverage without widening the
24-scenario model protocol or changing product defaults.
The concurrent mainline's component fixtures remain historical inputs. Their
model, repetition count and candidate bindings do not transfer to the merged
production prompt; the complete declared protocol must be run again.
