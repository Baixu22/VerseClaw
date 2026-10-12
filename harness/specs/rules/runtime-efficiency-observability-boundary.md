---
id: runtime-efficiency-observability-boundary
title: Runtime Efficiency Observability Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
pathPatterns:
  - electron/services/efficiency-sampler.ts
  - electron/services/efficiency-power-policy.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/main/index.ts
  - scripts/validate-runtime-efficiency.mjs
  - artifacts/runtime-efficiency/**
  - tests/unit/runtime-efficiency-sampler.test.ts
  - tests/unit/runtime-efficiency-power-policy.test.ts
  - tests/unit/agent-trace-graph-layout-bench.test.ts
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-efficiency-sampler.test.ts tests/unit/runtime-efficiency-power-policy.test.ts
  - node scripts/validate-runtime-efficiency.mjs --validate-only --out artifacts/runtime-efficiency/report.json
---

# Runtime Efficiency Observability Boundary

Product-runtime efficiency must be measurable before it can be optimized. This
rule governs the measurement surface, not any particular optimization.

## Requirements

- **Measured, never synthesized.** Efficiency samples MUST come from real
  operating-system or process counters. Constants, estimates, interpolation, or
  hardcoded stand-ins are violations even when they produce a passing report.
- **Every sample is attributable.** Each sample carries a timestamp and a
  `source` label identifying where the numbers came from.
- **Fail closed on missing evidence.** A report with zero samples, or coverage
  below the configured minimum, MUST fail validation. An unmeasured run is
  never reported as a healthy run.
- **Bounded by construction.** Rolling sample retention MUST have a hard cap and
  evict oldest-first. Disabled or stopped sampling MUST leave no pending timer
  and perform no interval work, so measurement can never become a tax on the
  user.
- **Shedding is observable and reversible.** Idle and power-state load shedding
  MUST produce explicit state transitions with a reason, and MUST restore the
  prior load when the condition clears.
- **Shedding only touches background work.** User-initiated work MUST NOT be
  gated by the shed policy.
- **No improvement claim without artifacts.** Recording a performance
  improvement requires a stored before/after artifact pair produced by
  agent-driven runs. Synthetic or historical evidence MUST NOT be upgraded into
  a measured result.

## Boundaries

- This rule does not decide a rendering strategy. Whether to enable GPU
  acceleration, virtualize SVG output, or offload work to a worker is a
  separate decision that consumes these measurements.
- This rule does not own subagent fan-out quotas. The
  `windows-high-concurrency-stability-v1` terminal exec lease remains the owner
  of that surface.
- External telemetry transport is out of scope. Efficiency evidence is local
  only and is not uploaded anywhere.

## Validation

- `pnpm exec vitest run tests/unit/runtime-efficiency-sampler.test.ts tests/unit/runtime-efficiency-power-policy.test.ts`
- `node scripts/validate-runtime-efficiency.mjs`