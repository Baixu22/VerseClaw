---
lifecycleStatus: archived
id: a5-adaptive-context-budget-pilot
title: A5 Adaptive Context Budget — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A5 context budget planner from shadow to active pilot, gated by plan adoption rate and budget compliance.
touchedAreas:
  - openclaw_runtime/src/agents/cross-area/cross-area-facades.ts
  - openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/observability/deprecation-counters.ts
  - openclaw_runtime/src/observability/deprecation-counters.test.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.test.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-budget-shadow.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-promotion.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-promotion.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-p6.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-runtime.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/config/types.agent-defaults.ts
  - reports/context-compression/P6-DEVELOPMENT-PROMPT-2026-08-18.md
  - reports/context-compression/P6-EVIDENCE-2026-08-18.md
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.test.ts
  - tests/unit/deprecation-counters.test.ts
  - tests/unit/performance-budgets.test.ts
  - reports/context-compression/P5-EVIDENCE-2026-08-17.md
  - reports/context-compression/P6-DATA-PREP-STATUS-2026-08-18.md
  - reports/context-compression/production-compaction-entries-11.json
  - reports/context-compression/production-compaction-manifest-9.json
  - reports/context-compression/production-summaries-9.jsonl
  - reports/context-compression/production-summaries-9.meta.json
  - reports/context-compression/production-paired-trajectories-9.jsonl
  - reports/context-compression/failure-guidelines-p6-9.json
  - reports/context-compression/production-summaries-30-generated.jsonl
  - reports/context-compression/production-summaries-30-generated.meta.json
  - reports/context-compression/production-summaries-30-v5.jsonl
  - reports/context-compression/production-summaries-30-v5.jsonl.meta.json
  - reports/context-compression/production-summaries-30-v9.jsonl
  - reports/context-compression/production-summaries-30-v9.jsonl.meta.json
  - reports/context-compression/production-summaries-30-v10.jsonl
  - reports/context-compression/production-summaries-30-v10.jsonl.meta.json
  - reports/context-compression/production-summaries-30-v11.jsonl
  - reports/context-compression/production-summaries-30-v11.jsonl.meta.json
  - reports/context-compression/production-summaries-30-v14.jsonl
  - reports/context-compression/production-summaries-30-v14.jsonl.meta.json
  - scripts/context-compression-production-summary-regenerator.ts
  - scripts/context-compression-recovery-ledger.mjs
  - scripts/context-compression-would-retry-canary.ts
  - reports/context-compression/production-paired-trajectories-30.jsonl
  - reports/context-compression/failure-guidelines-p6-30.json
  - reports/context-compression/failure-guidelines-p6-a-phase2-reasoner.json
  - reports/context-compression/failure-guidelines-p6-a-v5-iteration.json
  - reports/context-compression/failure-guidelines-p6-a-reasoner.json
  - reports/context-compression/production-paired-trajectories-30-reasoner.jsonl
  - reports/context-compression/P6-A-AUTOMATED-ACCEPTANCE-EVIDENCE-2026-08-18.md
  - reports/context-compression/P6-WOULD-RETRY-CANARY-2026-08-19.md
  - artifacts/context-compression-p5/**
  - harness/specs/tasks/a5-adaptive-context-budget-pilot.md
  - harness/specs/tasks/token-dense-recovery-compression-v1.md
residualPaths:
  - docs/clawx-design-overview.md
  - electron/services/sessions-api.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.recall.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-addressability.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-addressability.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.ts
  - reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md
  - reports/context-compression/P0-EVIDENCE-2026-08-17.md
  - reports/context-compression/P1-DEVELOPMENT-PROMPT-2026-08-17.md
  - reports/context-compression/P1-EVIDENCE-2026-08-17.md
  - reports/context-compression/P2-DEVELOPMENT-PROMPT-2026-08-17.md
  - reports/context-compression/P2-EVIDENCE-2026-08-17.md
  - reports/context-compression/P3-DEVELOPMENT-PROMPT-2026-08-17.md
  - reports/context-compression/P3-EVIDENCE-2026-08-17.md
  - reports/context-compression/P4-ACCEPTANCE-EVIDENCE-2026-08-17.md
  - reports/context-compression/P4-ACCEPTANCE-PROMPT-2026-08-17.md
  - reports/context-compression/P4-DEVELOPMENT-PROMPT-2026-08-17.md
  - reports/context-compression/P4-EVIDENCE-2026-08-17.md
  - reports/context-compression/P5-DEVELOPMENT-PROMPT-2026-08-17.md
  - reports/context-compression/P5-EXECUTION-PROMPT-2026-08-17.md
  - reports/context-compression/production-manifest-30.json
  - scripts/context-compression-eval-runner.mjs
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/compression-artifact.test.ts
  - tests/unit/context-compression-eval.test.ts
  - tests/unit/context-runtime-kit-recovery-context.test.ts
  - tests/unit/helpers/context-compression-eval.ts
expectedUserBehavior:
  - P5 compaction budget shadow records plan adoption, ignored plans, and budget exceeded through the existing A5 deprecation counters without changing returned summaries or artifacts.
  - A5 budget violation diagnosis degrades to default budget through the existing registry when ignored plans exceed 20%.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - tests/unit/cross-area-composition.test.ts
  - tests/unit/resource-aware-wave-scheduler.test.ts
  - tests/unit/performance-budgets.test.ts
  - pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-planner.test.ts src/context-engine/context-orchestrator.test.ts --reporter=dot
  - pnpm exec vitest run tests/unit/deprecation-counters.test.ts tests/unit/performance-budgets.test.ts --reporter=dot
acceptance:
  - A5 deprecation counter `planIgnoredCount` rate ≤ 20% over 100-turn session
  - A5 p99 ≤ 30ms (criterion 4.8)
  - `ContextBudgetPlanner.replanOnResume` re-executes on resume, not stale (criterion 3.6)
  - Wave immutability: started waves not re-planned (criterion 3.9)
  - Budget violation response `degrade_to_default_budget` triggers when ignored rate > 20%
  - P5 real compaction call sites increment planAdoptedCount/planIgnoredCount/budgetExceededCount deterministically
  - P5 planner threshold overrides are clamped earlier than the production ladder and default behavior is byte-identical without a schedule
  - P5 budgetShadow remains diagnostics-only and never enters CompressionArtifact
  - P5 nativeMemory/nativeContextGating negotiation is additive and keeps provenance receipts
docs:
  required: true
---
## Graduation gate

A5 graduates from shadow to active pilot when ALL of the following hold:

1. **Plan adoption rate** ≥ 80%: `planAdoptedCount / (adopted + ignored) ≥ 0.80`.
2. **Performance**: p99 ≤ 30ms for 100-turn session (criterion 4.8).
3. **Resume re-execution**: planner re-executes on resume, not stale (criterion 3.6).
4. **Wave immutability**: started waves not re-planned (criterion 3.9).
5. **Budget violation response**: `degrade_to_default_budget` triggers when ignored > 20% (criterion 4.14).
6. **Per-turn cumulative budget**: p99 ≤ 300ms with A1+A5+A3 active (criterion 4.10).

## Out of scope

- Dynamic degradation order shifting (OQ-012, Stage 5).
- Per-area memory budget allocation (OQ-011, Stage 5).
