---
id: p2-issue-fixes-batch13-20261010
title: P2 issue batch 13 - automated runtime-memory cutover evidence gate
lifecycleStatus: active
taskType: evidence-gate
intent: Replace the missing runtime-memory shadow-to-product promotion decision with a bounded, agent-runnable evidence evaluator and CLI, while leaving frozen product defaults unchanged unless a separately authorized default-lock change occurs.
touchedAreas:
  - openclaw_runtime/src/memory/**
  - scripts/**
  - tests/unit/**
  - harness/specs/**
  - docs/**
  - docs/README.md
  - package.json
expectedUserBehavior:
  - A reviewer or agent can evaluate sanitized runtime-memory pilot metrics against explicit sample, success, latency, token-overhead and safety thresholds.
  - Eligible evidence reports product-cutover stage; insufficient or unsafe evidence reports shadow/guarded-opt-in with concrete reasons.
  - The evaluator itself never flips writeEnabled/useEnabled or any frozen product default, so default-off behavior remains parity-safe.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - changing frozen product defaults or feature locks inside the evaluator
  - accepting model prose as cutover evidence without bounded metrics and refs
  - treating an eligible calculation as an automatic production default flip
  - requiring a human verdict or live operator to unblock the gate
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-dual-gate-p3-003.test.ts
  - pnpm memory:cutover-gate --evidence <evidence.json>
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch13-20261010.md
acceptance:
  - Issue #143 - evaluateMemoryCutoverGate validates sample size, success rate, p95 latency ratio, token overhead, safety regressions, agent provenance and evidence refs.
  - Issue #143 - the decision reports shadow, guarded-opt-in or product-cutover with explicit reasons and defaultGateUnchanged: true.
  - Issue #143 - CLI evidence input and generated decision are reproducible; tests cover eligible, performance-degraded, insufficient-sample, unsafe and non-agent cases.
  - Issue #143 - default runtime-memory write/use gates remain off in this change; a default-lock flip remains a separate explicit owner decision, not a human-evidence blocker.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch13-20261010.md
---

# P2 issue batch 13

This batch addresses the missing automated runtime-memory cutover decision in
issue #143. It provides an agent-runnable evidence gate and CLI; it deliberately
does not change frozen defaults or claim that product cutover has occurred.