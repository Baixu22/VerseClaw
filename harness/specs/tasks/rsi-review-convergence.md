---
lifecycleStatus: active
id: rsi-review-convergence
title: Review and align the RSI evaluation, feedback and evidence layers
intent: Repair reproducible false promotion paths, align the feedback exporter with its production store, and make retained evidence readback reject missing or stale inputs without changing the frozen policy or product defaults.
diffBase: d8d1691a2
touchedAreas:
  - scripts/lib/paired-ablation.*
  - scripts/lib/reliability-aggregation.*
  - scripts/lib/evidence-binding.*
  - scripts/rsi-*.mjs
  - scripts/rsi-*.d.mts
  - tests/unit/rsi-*.test.ts
  - tests/unit/agent-dev-paired-ablation.test.ts
  - tests/unit/agent-dev-reliability-aggregation.test.ts
  - tests/unit/agent-dev-ablation-verdict-guards.test.ts
  - tests/unit/evidence-binding.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/**
  - harness/specs/fixtures/rsi-sekb-arms/**
  - harness/specs/fixtures/rsi-feedback-loop/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - harness/specs/tasks/rsi-review-convergence.md
  - harness/specs/guides/rsi-evidence-binding.md
  - docs/dev/rsi-capability-and-boundaries.md
  - docs/dev/rsi-decision-implementation.md
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
  - paired-ablation-boundary
expectedUserBehavior:
  - The evaluation and promotion layers agree on safety, pairing and cost failures.
  - Feedback export reads the role-memory database and preserves unknown and partial outcomes.
  - Check commands read and verify the saved report rather than accepting a different in-memory report.
requiredTests:
  - node scripts/rsi-decision-check.mjs --json
  - node scripts/rsi-feedback-pilot.mjs --check --json
  - node scripts/rsi-sekb-arms.mjs --check --json
  - node scripts/rsi-historical-task-corpus.mjs --check
  - node scripts/rsi-tf0604-baseline.mjs --check --json
  - node scripts/rsi-tf0592-statistical-adjudication.mjs --check --json
  - node scripts/rsi-measurement-archive.mjs --check --json
  - pnpm exec vitest run tests/unit/rsi-decision-check.test.ts tests/unit/rsi-feedback-export.test.ts tests/unit/rsi-feedback-pilot.test.ts tests/unit/rsi-sekb-arms.test.ts tests/unit/rsi-sekb-arms-decision.test.ts tests/unit/rsi-evidence-loop-contract.test.ts tests/unit/rsi-tf0604-baseline.test.ts tests/unit/rsi-tf0592-statistical-adjudication.test.ts tests/unit/rsi-historical-task-corpus.test.ts tests/unit/rsi-measurement-archive.test.ts tests/unit/agent-dev-ablation-verdict-guards.test.ts tests/unit/agent-dev-paired-ablation.test.ts tests/unit/agent-dev-reliability-aggregation.test.ts tests/unit/evidence-binding.test.ts tests/unit/runtime-memory-paired-ablation.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/rsi-review-convergence.md
  - git diff --check
acceptance:
  - Regression tests demonstrate that safety violations, invalid numerical evidence, incomplete comparisons, shadow drift and unknown evidence cannot promote.
  - TF-0592 applies the existing 10 percent ceiling to both tokens and tool calls without rounding overruns into compliance.
  - passK and passAtK are present separately; missing cost measurements stay unavailable.
  - Feedback export resolves the production role-memory database and preserves success, partial, failure and unknown states; task labels never become complete experimental cases.
  - Renamed judged paths, unreadable Git state, omitted hash entries and undeclared non-judged exceptions fail closed; unrelated documentation remains a warning.
  - Saved reports, all seven checks and the full scoped unit suite are read back from disk, with no provider calls or real-human claims.
  - Original historical provider inputs and failure verdicts remain intact, and product locks remain false.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
    - docs/dev/rsi-decision-implementation.md
readmeUpdates: not-required
---

This is evaluator maintenance under the existing RSI program. The numerical
promotion gate is not independent execution, product authorization or release
approval. Existing README explanations remain accurate because feedback stays
diagnostic and no runtime, UI or default changes are made.

Use a clean checkout of the resulting commits for changed-path ownership while
preserving unrelated work in the shared checkout. Logs and temporary fixtures
belong under D:/tmp. Agent-generated regression data is synthetic, including
tests of the analyzer's live-provider input branch.
