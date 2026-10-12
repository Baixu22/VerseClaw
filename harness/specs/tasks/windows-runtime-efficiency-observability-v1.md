---
id: windows-runtime-efficiency-observability-v1
title: Windows runtime efficiency observability v1
lifecycleStatus: completed
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make product-runtime efficiency measurable on Windows by sampling real CPU/memory counters in the Main process on a bounded cadence, shedding background work on idle/power saving, and writing local, fail-closed efficiency evidence that later rendering and concurrency decisions can consume instead of inferences.
expectedUserBehavior:
  - The Main process records real process CPU and memory samples on a fixed, bounded cadence and keeps a bounded rolling summary.
  - Sampling starts with the application lifecycle and is released on quit; disabled or stopped sampling performs no interval work and leaves no pending timer.
  - When the window is hidden or the OS reports a power-saving state, background polling and non-essential loops are shed, the shed state is observable, and the prior state is restored when the condition clears.
  - Efficiency evidence is written to a local artifact carrying a schema, sample count and coverage window, and is never treated as a pass without a non-zero sample count.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - docs-sync
  - repository-artifact-retention
  - runtime-efficiency-observability-boundary
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - electron/services/efficiency-sampler.ts
  - electron/services/efficiency-power-policy.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/main/index.ts
  - scripts/validate-runtime-efficiency.mjs
  - tests/unit/runtime-efficiency-sampler.test.ts
  - electron/services/efficiency-api.ts
  - src/components/settings/EfficiencySamplingPanel.tsx
  - src/lib/host-api.ts
  - src/pages/Settings/index.tsx
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - electron/utils/store.ts
  - electron/main/ipc-handlers.ts
  - tests/unit/runtime-efficiency-api.test.ts
  - tests/unit/efficiency-sampling-panel.test.tsx
  - tests/e2e/settings-efficiency-sampling.spec.ts
  - docs/dev/p2-runtime-efficiency-settings-20261012.md
  - docs/dev/p2-runtime-efficiency-settings-20261012/acceptance.json
  - docs/dev/p2-runtime-efficiency-settings-20261012/SHA256SUMS
  - harness/specs/tasks/p2-runtime-efficiency-settings-20261012.md
  - tests/unit/runtime-efficiency-power-policy.test.ts
  - tests/unit/agent-trace-graph-layout-bench.test.ts
  - artifacts/runtime-efficiency/**
  - docs/dev/windows-runtime-efficiency-observability.md
  - harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - harness/specs/rules/runtime-efficiency-observability-boundary.md
  - scripts/repository-artifacts.json
  - .gitignore
residualPaths:
  - docs/dev/error-governance-audit-2026-10-09.md
  - docs/dev/provider-error-retry-boundaries.md
  - docs/dev/repository-cleanup-triage-2026-10-08.md
  - docs/dev/security-reality-audit-20261009.md
docs:
  required: true
  paths:
    - docs/dev/windows-runtime-efficiency-observability.md
requiredTests:
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - pnpm exec vitest run tests/unit/runtime-efficiency-sampler.test.ts tests/unit/runtime-efficiency-power-policy.test.ts tests/unit/agent-trace-graph-layout-bench.test.ts
  - node scripts/validate-runtime-efficiency.mjs --validate-only --out artifacts/runtime-efficiency/report.json
acceptance:
  - The sampler reports real measured values from the operating system rather than constants or estimates, and each sample carries a timestamp and source label.
  - A bounded rolling window is retained; older samples are evicted and the retained count never exceeds the configured maximum.
  - Disabled or stopped sampling performs no interval work, releases its timer, and leaves no pending handle.
  - The efficiency artifact is written with schema, generatedAt, sample count and coverage window; the validator fails closed when sampleCount is zero or coverage is below the configured minimum.
  - Power/idle shedding produces an explicit observable state transition with a reason, restores the prior state when the condition clears, and never disables user-initiated work.
  - No claim of measured improvement is recorded without a before/after artifact pair produced by agent-driven runs.
---

# Windows runtime efficiency observability v1

This change set lands the **measurement core** on Windows: a Main-process sampler over real
OS counters with a bounded rolling window, a power/idle load-shedding policy with observable
and reversible state transitions, an orchestrator wired into the app lifecycle, a pure-Node
evidence validator that fails closed, and the unit coverage plus one layout-cost benchmark.

## Scope actually landed

- `efficiency-sampler.ts` - real process CPU/memory counters with a source label, timestamped
  samples, hard retention cap, eviction of oldest first, and a minimum interval so sampling
  cannot become a hot loop.
- `efficiency-power-policy.ts` - explicit shed state machine with a reason, restored when the
  condition clears; only background work is affected.
- `efficiency-orchestrator.ts` - starts/stops sampling with the app lifecycle and routes the
  shed decision.
- `electron/main/index.ts` - `startRuntimeEfficiency()` on ready and `stopRuntimeEfficiency()` in
  the quit path, so quit never waits on the sampling timer.
- `scripts/validate-runtime-efficiency.mjs` - probe and `--validate-only` modes, fail-closed on
  zero samples or insufficient coverage, writes `artifacts/runtime-efficiency/report.json`.
- `tests/unit/agent-trace-graph-layout-bench.test.ts` - a bounded layout-cost benchmark kept as
  the "measure before optimizing" companion for future rendering work (it asserts a
  characterization, not a performance gate).

## Follow-up landed (2026-10-12, issue #161)

The Settings toggle and the host-api/contract exposure of the latest sample and summary are now
implemented: `shared/host-api/contract.ts` has an `efficiency` module, `electron/services/efficiency-api.ts`
serves it, `src/lib/host-api.ts` exposes it, and `src/components/settings/EfficiencySamplingPanel.tsx`
renders the switch plus a fail-closed "not sampled" readout in Settings > Developer with four-locale
i18n. Sampling is gated on the persisted `efficiencySamplingEnabled` setting (default true) and an
Electron E2E spec (`tests/e2e/settings-efficiency-sampling.spec.ts`) is added in the same change set.
See `docs/dev/p2-runtime-efficiency-settings-20261012.md`.

- No before/after optimization artifact pair exists yet, so no measured improvement is claimed.

## Out of scope

- Changing `app.disableHardwareAcceleration()`; rendering strategy is a separate decision covered
  by the SVG/virtualization work.
- Subagent fan-out quotas; the existing `windows-high-concurrency-stability-v1` terminal exec lease
  remains the owner of that surface.
- Any performance improvement claim that is not backed by a stored before/after artifact.
- External telemetry transport: efficiency evidence is local only and is never uploaded.
