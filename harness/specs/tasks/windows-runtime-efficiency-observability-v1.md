---
id: windows-runtime-efficiency-observability-v1
title: Windows runtime efficiency observability v1
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make product-runtime efficiency measurable on Windows by adding real CPU/memory sampling and an idle/power-aware load-shedding policy, so later rendering and concurrency optimizations can be proven instead of inferred.
expectedUserBehavior:
  - Settings can enable or disable runtime efficiency sampling; the default is enabled with a bounded sample rate.
  - The app records real process CPU and memory samples on a fixed cadence and exposes the latest sample plus a bounded rolling summary.
  - Efficiency evidence is written to a local artifact with a schema, sample count and coverage window, and is never treated as a pass without a non-zero sample count.
  - When the window is hidden or the OS reports a power-saving state, periodic background polling and non-essential render loops are shed, and the shed state is observable.
  - Sampling is bounded: disabled sampling performs no work, and the sampler never blocks or adds measurable main-thread cost beyond its configured interval.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - electron/services/efficiency-sampler.ts
  - electron/services/efficiency-power-policy.ts
  - electron/main/index.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - scripts/validate-runtime-efficiency.mjs
  - tests/unit/runtime-efficiency-sampler.test.ts
  - tests/unit/runtime-efficiency-power-policy.test.ts
  - artifacts/runtime-efficiency/**
  - docs/dev/windows-runtime-efficiency-observability.md
  - harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - harness/specs/rules/runtime-efficiency-observability-boundary.md
docs:
  required: true
  paths:
    - docs/dev/windows-runtime-efficiency-observability.md
requiredTests:
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - pnpm exec vitest run tests/unit/runtime-efficiency-sampler.test.ts tests/unit/runtime-efficiency-power-policy.test.ts
  - node scripts/validate-runtime-efficiency.mjs --validate-only --out artifacts/runtime-efficiency/report.json
acceptance:
  - The sampler reports real measured values from the operating system rather than constants or estimates, and each sample carries a timestamp and source label.
  - A bounded rolling window is retained; older samples are evicted and the retained count never exceeds the configured maximum.
  - Disabled or stopped sampling performs no interval work, releases its timer, and leaves no pending handle.
  - The efficiency artifact is written with schema, generatedAt, sample count and coverage window; the validator fails closed when sampleCount is zero.
  - Power/idle shedding produces an explicit observable state transition, restores the prior state when the condition clears, and never disables user-initiated work.
  - Renderer access goes through host-api/api-client only; no new direct ipcRenderer.invoke or Gateway HTTP call is introduced in pages/components.
  - No claim of measured improvement is recorded without a before/after artifact pair produced by agent-driven runs.
---

## Out of scope

- Changing `app.disableHardwareAcceleration()`; rendering strategy is a separate decision covered by the SVG/virtualization work.
- Subagent fan-out quotas; the existing `windows-high-concurrency-stability-v1` terminal exec lease remains the owner of that surface.
- Any performance improvement claim that is not backed by a stored before/after artifact.