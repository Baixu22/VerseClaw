---
lifecycleStatus: active
id: electron-performance-instrumentation
title: Electron performance instrumentation for TF-0417
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add local, replayable Main and renderer performance counters without an external APM, a second telemetry authority, or any default product-lock change.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/main/index.ts
  - electron/services/code-review-api.ts
  - electron/services/efficiency-api.ts
  - electron/services/git-api.ts
  - electron/services/office-tools-api.ts
  - electron/services/performance-metrics.ts
  - electron/services/resource-tracker.ts
  - electron/services/skill-packs-api.ts
  - electron/services/vtoken-bridge.ts
  - electron/utils/counted-child-process.ts
  - electron/utils/openclaw-cli.ts
  - electron/utils/sandbox-provider-detection.ts
  - shared/host-api/contract.ts
  - src/lib/host-api-client.ts
  - src/lib/performance-metrics.ts
  - src/main.tsx
  - tests/unit/efficiency-sampling-panel.test.tsx
  - tests/unit/performance-metrics.test.ts
  - tests/unit/runtime-efficiency-api.test.ts
  - harness/specs/tasks/electron-performance-instrumentation.md
  - harness/specs/fixtures/tf0417-performance-instrumentation/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - gateway-backend-communication
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - "The existing Settings > Developer efficiency readout continues to work; the new performance snapshot is additive and does not change default product locks."
  - Repeated local runs report measured startup marks, child-process invocation counts, live interval counts and renderer long-task/IPC samples without uploading data.
  - A missing optional metric is reported as unavailable rather than inferred from static source.
requiredTests:
  - tests/unit/performance-metrics.test.ts
  - tests/unit/efficiency-sampling-panel.test.tsx
  - tests/unit/runtime-efficiency-api.test.ts
acceptance:
  - Main process records app-ready, window-created and ready-to-show marks with relative timings.
  - Main process reports real child-process invocation counts and live interval counts.
  - "Renderer reports first-paint, long tasks >= 50 ms, click/key latency and IPC P50/P95 in a bounded local JSON ring buffer."
  - A real Electron probe can repeat a 15-second smoke run and a five-minute idle run with driven_by=agent output.
  - All required tests, typecheck, contract check, harness validation, repository artifact retention and agent-dev:fast pass.
docs:
  required: false
---

# TF-0417 Electron Performance Instrumentation

## Objective

Give the existing local efficiency sampler real process and renderer counters so
startup and long-running regressions can be measured instead of inferred.

## Scope

- Main process records `app-ready`, `window-created` and `ready-to-show` marks.
- Main process counts child-process invocations through one explicit wrapper and
  counts live intervals created after startup instrumentation.
- The efficiency host contract exposes a bounded snapshot of marks, counters,
  recent spawns and current RSS.
- Renderer records first-paint, long tasks (>= 50 ms), click/key latency and
  host IPC durations, and persists a bounded JSON ring buffer in localStorage.
- The probe under `harness/specs/fixtures/tf0417-performance-instrumentation/`
  runs the real built Electron main output locally for 15 seconds or 5 minutes
  and writes a merged `driven_by: agent` report.

## Acceptance

- `pnpm exec vitest run tests/unit/performance-metrics.test.ts tests/unit/efficiency-sampling-panel.test.tsx tests/unit/runtime-efficiency-api.test.ts` passes.
- `pnpm run typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm harness validate --spec harness/specs/tasks/electron-performance-instrumentation.md` passes.
- `pnpm repo:artifacts:check` passes.
- `pnpm agent-dev:fast` passes.
- The 15-second smoke probe and one 5-minute real Electron probe complete with
  measured marks, spawn count, active interval count, renderer long-task
  samples and IPC P50/P95; unavailable fields remain explicit.
