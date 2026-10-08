---
id: p4-05-07-acceptance
title: FP-P4-05 through FP-P4-07 combined acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Validate the combined uncommitted FP-P4-05, FP-P4-06, and FP-P4-07 working-tree changes under one diff-complete Harness gate without changing product defaults or readiness claims.
touchedAreas:
  - .gitignore
  - package.json
  - artifacts/coding-c1/**
  - artifacts/dcs-canary/c1/**
  - artifacts/first-product-preview/FP-P0-05/**
  - artifacts/first-product-preview/FP-P4-05/**
  - docs/dev/dcs-visible-production/**
  - docs/dev/first-product-controlled-preview/**
  - docs/dev/handoffs/LATEST.md
  - docs/dev/unified-agent-system/**
  - electron/services/vtoken-bridge.ts
  - harness/specs/rules/c1-gate-corpus-authority.md
  - harness/specs/rules/dcs-production-flags-localization.md
  - harness/specs/tasks/dcs-production-flags-localization.md
  - harness/specs/tasks/p4-05-07-acceptance.md
  - harness/specs/tasks/unified-c1-gate-corpus.md
  - harness/specs/tasks/vtoken-default-off-documentation.md
  - harness/specs/tasks/vtoken-foundation-bridge.md
  - openclaw_runtime/scripts/coding-c1-ab.mts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.test.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.ts
  - packages/vtoken/README.HOST.md
  - scripts/c1-authoritative-decision.mjs
  - scripts/dcs-ops-preflight.mjs
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/vtoken/types.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
  - tests/unit/c1-authoritative-decision.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - tests/unit/dcs-production-flags-localization.test.ts
  - tests/unit/vtoken-default-off-documentation.test.ts
expectedUserBehavior:
  - C1 decisions expose one authoritative real-tool reduction result and keep the feature off below the unchanged threshold.
  - Current VToken documentation consistently describes default-off opt-in behavior while corrected historical claims remain auditable.
  - Japanese and Russian users see the complete Settings Developer DCS surface in their selected language.
  - No combined change implies live readiness, product approval, default-on behavior, or GA evidence.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - c1-gate-corpus-authority
  - vtoken-foundation-boundary
  - dcs-production-flags-locale-quality
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - tests/unit/c1-authoritative-decision.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - tests/unit/vtoken-default-off-documentation.test.ts
  - tests/unit/default-config-matrix.test.ts
  - tests/unit/dcs-production-flags-localization.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.test.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
acceptance:
  - Every file changed by FP-P4-05 through FP-P4-07 is covered by this task spec or the communication scenario ownership list.
  - The authoritative C1 result remains 4.5x, meetsGate false, and keep-off.
  - Active VToken authority remains default OFF with no runtime behavior change.
  - Japanese and Russian locale trees preserve key, interpolation, and actionable-hint quality.
  - Full fast, comms, and Electron E2E profiles pass on the combined working tree.
  - liveReady, productApproved, and defaultOn remain false.
docs:
  required: true
  files:
    - docs/dev/first-product-controlled-preview/tasks/FP-P4-05.md
    - docs/dev/first-product-controlled-preview/tasks/FP-P4-06.md
    - docs/dev/first-product-controlled-preview/tasks/FP-P4-07.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/first-product-controlled-preview/tasks/README.md
    - docs/dev/Sustained-Development-Playbook.md
---

# FP-P4-05 through FP-P4-07 combined acceptance

This spec exists because the three tasks share one uncommitted working tree.
It is an acceptance envelope, not a fourth feature or a new authority source.
The individual task specs remain the source for each task's intent and detailed
acceptance criteria.

## Frozen boundaries

- `liveReady=false`
- `productApproved=false`
- `defaultOn=false`
- C1 remains `4.5x`, `meetsGate=false`, `recommendation=keep-off`
- `FP-P4-03` and `FP-P4-04` remain deferred
- No Task Forest apply, live canary, real remote effect, or product/GA claim

## Validation

- `pnpm harness validate --spec harness/specs/tasks/p4-05-07-acceptance.md --since HEAD`
- `pnpm harness run --spec harness/specs/tasks/p4-05-07-acceptance.md --since HEAD`
- `pnpm contract:check`
- `pnpm run typecheck`
- `git diff --check`
