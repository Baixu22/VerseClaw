---
id: p2-issue-fixes-batch11-20261010
title: P2 issue batch 11 - failed and retried usage attribution
lifecycleStatus: active
taskType: engineering-acceptance
intent: Extend the existing transcript-backed token usage history so failed, aborted, retried and fallback calls remain distinguishable from malformed usage records, join to the persisted model-call identity from #112, and surface unknown attribution without inventing zero-cost records.
touchedAreas:
  - electron/utils/**
  - shared/host-api/**
  - shared/i18n/locales/**
  - src/pages/Billing/**
  - src/pages/Models/**
  - tests/unit/**
  - tests/e2e/**
  - harness/specs/**
  - docs/**
  - docs/README.md
expectedUserBehavior:
  - A failed or aborted model call with valid usage remains billable and is visibly marked failed/aborted.
  - Retry and provider-fallback calls are shown as retry/fallback and retain their run/attempt/model-call identity when present.
  - Malformed usage stays a parse-quality error, separate from execution failure; missing usage or missing call metadata stays unknown/not attributable rather than becoming zero-cost.
  - Billing recent records and aggregate diagnostics continue to use the same transcript source and never create a second ledger.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
forbiddenPatterns:
  - inferring failure or retry from timestamps or conversation order
  - treating unavailable usage or unknown attribution as zero cost
  - a second token/cost ledger or a new error taxonomy
  - claiming third-party provider billing behavior from local transcript evidence
  - enabling RC-03 by default or changing product locks
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/token-usage.test.ts
  - pnpm run typecheck:test
  - pnpm i18n:lint
  - pnpm contract:check
  - pnpm run test:e2e tests/e2e/billing-page.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch11-20261010.md
acceptance:
  - Issue #124 - parser projects executionStatus, retryKind, attributionStatus, runId, attemptIndex, modelCallIndex, wireAttemptIndex and correlationDigest from persisted transcript modelCall metadata.
  - Issue #124 - failed/aborted/retried/unknown-attribution counts are available in summaries and aggregates; billable token/cost totals still include only available usage and remain conserved.
  - Issue #124 - Billing recent rows visibly distinguish execution failure, retry/fallback and unknown attribution, with English/Chinese/Japanese/Russian strings.
  - Issue #124 - an Electron Billing E2E fixture asserts the visible failed/retry/unknown-attribution states; local build/environment limitations are recorded if the suite cannot run.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch11-20261010.md
---

# P2 issue batch 11

This batch closes the failed/retried usage-attribution gap in issue #124 by
consuming the deterministic transcript/model-call metadata added for #112. It
extends the existing parser, host contract, aggregates and Billing consumer; it
does not create a second billing ledger or claim provider-side billing truth.