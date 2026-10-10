---
lifecycleStatus: archived
id: context-family-policy-promotion
title: Context Family policy promotion
scenario: context-family
taskType: runtime-promotion
intent: Promote proven Context Family shadow behavior into default runtime policy in small reversible steps with metrics and rollback.
touchedAreas:
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/gateway/**
  - electron/services/**
  - shared/host-api/**
  - src/lib/**
  - src/pages/Chat/**
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/**
  - docs/context-family/**
expectedUserBehavior:
  - Context token pressure decreases without reducing recovery fidelity or evidence retention.
  - Legacy behavior remains available through rollback or flags.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-family-policy-promotion.md
  - pnpm harness validate --spec harness/specs/tasks/context-family-policy-promotion.md
  - pnpm run typecheck
  - pnpm test
  - pnpm run test:e2e
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- openclaw_runtime/src/context-engine openclaw_runtime/src/agents/embedded-agent-runner openclaw_runtime/src/gateway electron/services shared/host-api src/lib src/pages/Chat shared/i18n/locales tests docs/context-family README.md README.zh-CN.md README.ja-JP.md
acceptance:
  - Each promoted behavior has a flag, rollback path, and flag-off parity coverage.
  - Metrics compare token reduction, evidence retention, recovery fidelity, and failure modes against baseline.
  - No unrelated promotion is bundled.
  - Active tool-call blocking is not introduced unless a narrower task spec authorizes it.
  - README docs are updated when user-visible behavior changes.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Promotion is the last step, not the place to discover missing foundations.
