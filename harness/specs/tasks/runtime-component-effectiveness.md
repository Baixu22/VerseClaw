---
id: runtime-component-effectiveness
title: Runtime component effectiveness evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a quantitative runtime effectiveness report that proves whether backend components are actually triggered and useful in deterministic and optional live lanes.
touchedAreas:
  - scripts/runtime-effectiveness.mjs
  - package.json
  - harness/specs/tasks/runtime-component-effectiveness.md
  - tests/unit/helpers/runtime-effectiveness-eval.ts
  - tests/unit/runtime-effectiveness-eval.test.ts
  - vitest.runtime-effectiveness.config.ts
  - openclaw_runtime/extensions/codegraph/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/agents/clawgraph/**
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/agents/session-transcript-repair.ts
  - openclaw_runtime/src/agents/session-file-repair.ts
expectedUserBehavior:
  - Operators can run `pnpm runtime:effectiveness` to generate deterministic quantitative evidence under `artifacts/runtime-effectiveness`.
  - Operators can run `pnpm runtime:effectiveness:live` to append live-lane availability context without replacing deterministic evidence.
  - The report distinguishes real runtime effect from registration-only or shadow-only behavior.
  - The report explains authority boundaries, known overlap risks, explicit non-goals, and deterministic hard-gate acceptance.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/runtime-component-effectiveness.md
  - pnpm exec vitest run tests/unit/runtime-effectiveness-eval.test.ts
  - pnpm runtime:effectiveness
  - pnpm exec vitest run tests/integration/loop-stability-check.test.ts
  - pnpm runtime:effectiveness:codegraph-e2e
acceptance:
  - The deterministic lane covers CodeGraph, TaskLoop/MissionLoop repair, ClawGraph, AgentMap shadow, and transcript/tool-call repair.
  - Deterministic hard-gate acceptance requires aggregate `effective`, CodeGraph `effective`, no blocked components, no regressions, and AgentMap `shadow-only`.
  - `report.json` includes component records with triggered, decision, effectivenessScore, metrics, evidence, and risks.
  - `report.json` includes backward-compatible `boundaryMatrix`, `overlaps`, `optimizationTargets`, `notInScope`, and `acceptance` sections.
  - AgentMap is scored as shadow-only unless future specs explicitly promote it; default-off/no-authority boundaries are treated as required evidence.
  - Live-lane unavailability is reported as context and must not erase deterministic lane results.
  - The evaluator does not add renderer UI or direct renderer Gateway transport.
docs:
  required: false
  note: CLI artifact behavior is documented by this task spec and the generated markdown report.
---

This evaluation is an evidence generator, not a production runtime cutover. It should measure the existing component boundaries and raise regressions when a component stops triggering, loses evidence, or violates its intended authority boundary.
