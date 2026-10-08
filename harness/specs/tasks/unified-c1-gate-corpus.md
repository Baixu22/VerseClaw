---
id: unified-c1-gate-corpus
title: Unified C1 gate corpus
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Establish one reproducible tool-call reduction authority for the C1 context view-tools flag while preserving synthetic scale evidence as reference-only and keeping product defaults closed.
touchedAreas:
  - .gitignore
  - harness/specs/tasks/unified-c1-gate-corpus.md
  - harness/specs/rules/c1-gate-corpus-authority.md
  - openclaw_runtime/scripts/coding-c1-ab.mts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.test.ts
  - package.json
  - scripts/c1-authoritative-decision.mjs
  - scripts/dcs-ops-preflight.mjs
  - artifacts/coding-c1/ab-metrics.json
  - artifacts/dcs-canary/c1/**
  - artifacts/first-product-preview/FP-P4-05/**
  - artifacts/first-product-preview/FP-P0-05/reduction-factor-reconciliation.md
  - tests/unit/c1-authoritative-decision.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-05.md
  - docs/dev/first-product-controlled-preview/tasks/README.md
  - docs/dev/dcs-visible-production/tasks/TASK-P1-01.md
  - docs/dev/dcs-visible-production/P1-01-LIVE-AB-PROTOCOL.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - Every C1 flag decision names one authoritative reduction factor and one source corpus.
  - The hand-authored corpus that executes real context tools is the gate authority despite its narrow coverage.
  - The deterministic 32-task synthetic corpus remains visible as scale evidence but cannot pass the product gate.
  - A below-threshold authoritative result keeps context view tools default-off.
  - No historical metric is deleted or relabeled as live evidence.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - c1-gate-corpus-authority
requiredTests:
  - tests/unit/c1-authoritative-decision.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.test.ts
acceptance:
  - The generated FP-P4-05 decision identifies exactly one gate-authority corpus and reduction factor.
  - The authority is the four-fixture hand-authored corpus whose on-arm executes real context tools.
  - The 32-task synthetic corpus is reference-only and remains live false.
  - Historical 4.5x and 5.125x values and their reduction definitions remain reproducible.
  - The authoritative 4.5x result fails the unchanged 5x metric threshold.
  - recommendation remains keep-off and liveReady, productApproved, and defaultOn remain false.
  - Missing, inconsistent, or misleading artifact fields fail validation instead of silently selecting another corpus.
docs:
  required: true
  files:
    - docs/dev/first-product-controlled-preview/tasks/FP-P4-05.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/dcs-visible-production/tasks/TASK-P1-01.md
    - docs/dev/dcs-visible-production/P1-01-LIVE-AB-PROTOCOL.md
    - docs/dev/Sustained-Development-Playbook.md
---

# Unified C1 gate corpus

Use this task spec for `FP-P4-05`. This is an evaluation-methodology and
evidence-authority change. It does not change runtime registration, Renderer or
Main communication, user-visible UI, feature defaults, or product approval.

## Validation

- `pnpm harness context --spec harness/specs/tasks/unified-c1-gate-corpus.md`
- `pnpm run dcs:c1:gate`
- `pnpm exec vitest run tests/unit/c1-authoritative-decision.test.ts tests/unit/dcs-ops-canary-hard-veto.test.ts`
- `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/coding-ab-fixtures.test.ts src/context-engine/dcs-canary-c1.test.ts`
- `pnpm contract:check`
- `pnpm harness validate --spec harness/specs/tasks/unified-c1-gate-corpus.md --since HEAD`
- `pnpm harness run --spec harness/specs/tasks/unified-c1-gate-corpus.md --since HEAD`
- `git diff --check`
