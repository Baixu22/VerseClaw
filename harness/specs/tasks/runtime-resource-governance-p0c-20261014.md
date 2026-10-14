---
lifecycleStatus: active
id: runtime-resource-governance-p0c-20261014
title: Runtime Resource Governance P0C - background work gate and real shed consumers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close issue #213 Work Package C by turning shed state into an executable background-work gate with enter/exit watermarks, minimum dwell, real defer/resume consumers, and API/UI evidence while never blocking foreground user work.
touchedAreas:
  - openclaw_runtime/src/resources/background-work-gate.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/services/efficiency-api.ts
  - electron/services/resource-tracker.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/settings/EfficiencySamplingPanel.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/background-work-gate.test.ts
  - tests/unit/resource-tracker.test.ts
  - tests/unit/efficiency-sampling-panel.test.tsx
  - tests/unit/runtime-efficiency-api.test.ts
  - harness/specs/tasks/runtime-resource-governance-p0c-20261014.md
  - docs/dev/runtime-resource-governance-p0c-20261014.md
  # Stacked Work Package B base (remove from this list when #226 lands on main).
  - docs/dev/runtime-resource-governance-p0b-20261014.md
  - electron/main/ipc-handlers.ts
  - harness/specs/tasks/runtime-resource-governance-p0b-20261014.md
  - openclaw_runtime/src/agents/resource-leases.test.ts
  - openclaw_runtime/src/agents/resource-leases.ts
  - openclaw_runtime/src/process/process-tree-sampler.ts
  - openclaw_runtime/src/resources/resource-envelope-snapshot-store.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - tests/unit/process-tree-sampler.test.ts
  - tests/unit/resource-envelope-api.test.ts
  - tests/unit/resource-envelope.test.ts
  - tests/unit/resource-leases.test.ts
expectedUserBehavior:
  - Shed state can defer registered background work without blocking foreground work.
  - Resource-tracker heartbeat is a real background consumer: it is deferred while the gate is closed and resumes when the gate reopens.
  - High/low watermarks plus a minimum dwell avoid flip-flop transitions.
  - API/UI expose real defer/resume counters and the last defer reason, not just policy state.
  - Disabling efficiency sampling stops the gate timer and clears its runtime state.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - docs-sync
  - runtime-efficiency-observability-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-resource-governance-p0c-20261014.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0c-20261014.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/runtime-resource-governance-p0c-20261014.md
  - pnpm exec vitest run tests/unit/background-work-gate.test.ts tests/unit/resource-tracker.test.ts tests/unit/efficiency-sampling-panel.test.tsx tests/unit/runtime-efficiency-api.test.ts tests/unit/runtime-efficiency-power-policy.test.ts
  - pnpm run typecheck
  - pnpm i18n:lint
acceptance:
  - BackgroundWorkGate.shouldDefer('foreground') is always false; background work alone can be deferred.
  - Entering is driven by shed signal or queue depth/tree RSS/tree CPU high watermark.
  - Exiting requires all active conditions below low watermarks and the minimum dwell; repeated high-side samples do not add transitions.
  - Background work registered through the resource tracker heartbeat is deferred while the gate is closed and runs after it reopens.
  - The host-api efficiency state exposes deferring state, deferred/resume counts, pending work and last defer reason.
  - The Settings panel renders those real counters/reason without claiming a measured performance improvement.
  - Existing foreground interaction tests remain green.
docs:
  required: true
  paths:
    - docs/dev/runtime-resource-governance-p0c-20261014.md
---

# Runtime Resource Governance P0C

This task closes issue #213 Work Package C: shed state becomes a bounded background-work gate with hysteresis and a real consumer, while user-initiated work is never gated.

## Scope

- Add pure BackgroundWorkGate state with high/low watermarks and minimum dwell.
- Feed it from runtime efficiency samples, Resource Envelope totals and the existing power/window shed signal.
- Route resource-tracker heartbeat through the gate as the first real background consumer.
- Expose gate state through efficiency host-api and the Settings readout.

## Out of scope

- Work Package D end-to-end pressure gates and provider/MCP/plugin prewarm consumers.
- Closing or delaying foreground user turns.
- Changing existing lease capacities, product locks or defaults.