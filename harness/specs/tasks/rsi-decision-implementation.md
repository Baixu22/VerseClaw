---
lifecycleStatus: active
id: rsi-decision-implementation
title: Implement the six RSI audit decisions and retain reproducible evidence
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement D1 C, D2 B, D3 A, D4 A, D5 A and D6 B from the 2026-11-01 decision report as an evaluator-owned change, with a versioned policy, prospective safety annotations, case-cluster inference, a curated historical measurement and honest diagnostic feedback surfaces.
diffBase: b9d46c37aa665d7fa30a6c1abb07beec8eac092a
touchedAreas:
  - scripts/lib/reliability-aggregation.*
  - scripts/lib/paired-ablation.*
  - scripts/rsi-*.mjs
  - scripts/rsi-*.d.mts
  - scripts/repository-artifacts.json
  - harness/specs/fixtures/rsi-evidence-loop/**
  - harness/specs/fixtures/rsi-feedback-loop/**
  - harness/specs/fixtures/rsi-sekb-arms/**
  - harness/src/profiles.mjs
  - harness/specs/fixtures/agent-first-system/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
  - harness/specs/tasks/rsi-*.md
  - harness/specs/rules/reliability-aggregation-boundary.md
  - harness/specs/rules/paired-ablation-boundary.md
  - harness/specs/guides/rsi-evidence-binding.md
  - openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts
  - openclaw_runtime/src/context-engine/handlers/task-loop-handler.test.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/pages/Knowledge/index.tsx
  - shared/i18n/locales/*/agents.json
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/agent-dev-*.test.ts
  - tests/unit/rsi-*.test.ts
  - tests/unit/runtime-memory-paired-ablation.test.ts
  - tests/e2e/role-memory-panel.spec.ts
  - tests/e2e/knowledge-hub.spec.ts
  - docs/dev/rsi-capability-and-boundaries.md
  - docs/dev/rsi-decision-implementation.md
  - docs/README.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .gitignore
  - package.json
expectedUserBehavior:
  - Memory feedback explicitly explains that it is diagnostic-only and does not change retrieval ranking or retention decisions.
  - Runtime Lessons explicitly labels adoption counts as diagnostic and retains the existing review workflow.
  - A reader can distinguish the failed historical provider measurement from deterministic replay and recompute the archived result offline.
requiredProfiles:
  - fast
  - rsi
  - comms
requiredRules:
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - sekb-assisted-review-boundary
  - sekb-hermes-default-off-boundary
  - agent-engineering-acceptance-boundary
scenarios:
  - gateway-backend-communication
humanEvidence: not-required
requiredTests:
  - node scripts/rsi-tf0604-baseline.mjs --check --json
  - node scripts/rsi-historical-task-corpus.mjs --check
  - node scripts/rsi-tf0592-statistical-adjudication.mjs --check --json
  - node scripts/rsi-measurement-archive.mjs --check --json
  - pnpm exec vitest run tests/unit/agent-dev-ablation-verdict-guards.test.ts tests/unit/agent-dev-paired-ablation.test.ts tests/unit/agent-dev-reliability-aggregation.test.ts tests/unit/rsi-evidence-loop-contract.test.ts tests/unit/rsi-tf0604-baseline.test.ts tests/unit/rsi-tf0592-statistical-adjudication.test.ts tests/unit/rsi-historical-task-corpus.test.ts tests/unit/rsi-measurement-archive.test.ts tests/unit/runtime-memory-paired-ablation.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/role-memory-panel.spec.ts tests/e2e/knowledge-hub.spec.ts --workers=1
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/rsi-decision-implementation.md
  - git diff --check
acceptance:
  - D1 has a new policy version, ordinary-case maxFlakeCases=1 and safety-case zero tolerance; the old rate policy and measured failure remain preserved.
  - D2 keeps the five-percentage-point product improvement floor separate from observed detectable effect and required sample size; confidence intervals use complete case clusters and no degenerate interval supports promotion.
  - D3 keeps the 24 task identities and recorded historical outcomes, adds at least three safety cases, a positive and a negative anchor with explicit oracle semantics, and rejects a negative-control acceptance even below the sample floor.
  - D4 retains a readable, hash-bound real-provider measurement on the default branch and distinguishes it from the deterministic replay; a fresh check rederives statistics from retained trial inputs without a provider or another branch checkout.
  - D5 shares complete-case pairing, variance, interval and power computation between E02 and TF-0592; correlated repeats are never independent inference units.
  - D6 labels adoption and role-memory feedback as diagnostic-only in all four locales, removes adoption_count from handoff ranking, and verifies the visible explanation in Electron E2E.
  - All refreshed evidence is read back from disk; the local Task Forest and handoff reflect the landed evidence and explicitly retain unavailable cost, contaminated historical inputs and unmeasured benefit as dated residuals.
  - liveReady, productApproved, defaultOn, releaseApproved and completeRsiImplementation remain false; this evaluator repair does not implement a product self-modification loop.
docs:
  required: true
  files:
    - docs/dev/rsi-decision-implementation.md
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: required
---

# RSI audit decisions

The owner's request to implement the named report authorizes its recommended
minimal path. This is a harness-owner repair, outside any measured candidate.
The decisions and reversal conditions live in the retained decision record.
Threshold and annotation changes are prospective; the 2026-10-31 measurement is
archived with its original policy, inputs, verdict and limitations.

The historical guard tasks are tasks whose successful oracle proves rejection.
A negative anchor must state whether trial success means rejection; an ordinary
negative input still requires failed trials. These semantics do not change the
pass^k task-success denominator.

Feedback remains a diagnostic record. An independently registered future task
may study feedback weights, budgets, an off-by-default flag and rollback only
after a protocol is frozen; this implementation does not select such weights.
