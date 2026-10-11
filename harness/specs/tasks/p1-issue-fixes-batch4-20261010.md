---
id: p1-issue-fixes-batch4-20261010
title: P1 issue batch 4 - verifier authority and evaluation honesty
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close P1 issues #106, #139, #140 and #142 by separating run completion from business verdicts, returning real p-values, exposing judge review coverage, and exercising default hydration budgets.
expectedUserBehavior:
  - A successful verifier run without a structured verdict cannot produce pass or verified, and a negative review is not masked by outcome.ok.
  - Paired t-test pValue is a real continuous two-sided Student t p-value rather than a constant proxy.
  - Judge sanity reports expose not_enabled/review_required/healthy status and null requiresPromptReview when no review samples exist.
  - Aggregate evaluation exercises the production default token budget/limit for a subset of queries and does not silently replace missing values with larger overrides.
touchedAreas:
  - openclaw_runtime/src/agents/orchestration-verifier-report.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts
  - tests/unit/orchestration-verifier-report-p2-005.test.ts
  - tests/unit/runtime-memory-eval-statistics.test.ts
  - tests/unit/helpers/runtime-memory-judge-freeze.ts
  - tests/unit/judge-sanity-check.test.ts
  - tests/unit/runtime-memory-eval-aggregate-report-real.test.ts
  - harness/specs/tasks/p1-issue-fixes-batch4-20261010.md
  - docs/dev/p1-issue-fixes-batch4-20261010.md
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/orchestration-verifier-report-p2-005.test.ts tests/unit/runtime-memory-eval-statistics.test.ts tests/unit/judge-sanity-check.test.ts tests/unit/runtime-memory-eval-aggregate-report-real.test.ts --maxWorkers=1
  - pnpm run typecheck
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch4-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Issue #106 - outcome.ok without a structured verificationVerdict yields fail/missing_structured_verdict; explicit pass/fail/repair_required still propagate; team status does not treat outcome.ok as verified.
  - Issue #139 - pairedTTest uses a regularized incomplete beta implementation of the Student t two-sided p-value; a varied-difference sample produces a true value greater than 0 and below 0.001.
  - Issue #140 - unreviewed judge sanity output has status=not_enabled, reviewCoverage=0 and requiresPromptReview=null instead of a false healthy verdict.
  - Issue #142 - MultiTurnQueryPlan budget fields are optional and the aggregate evaluation leaves them absent for half the query plans, exercising DEFAULT_TOKEN_BUDGET/DEFAULT_LIMIT.
  - Verification is synthetic/agent-driven; no live model or human review is claimed by this batch.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch4-20261010.md
---

# P1 issue batch 4

This batch removes three false-positive trust signals and one silent default
override: verifier completion is separated from a business pass, the p-value is
computed rather than fabricated, judge review coverage is explicit, and the
aggregate evaluation now exercises production default hydration budgets.
