---
lifecycleStatus: active
id: resource-timer-watcher-governance
title: P3 timer alignment and root-keyed watcher hub for TF-0411
type: task
intent: Replace Main periodic timers with one phase-aligned scheduler and add a root-keyed watcher hub that shares one OS watcher across subscribers, with measured interval, handle and shed-CPU evidence.
taskType: runtime-bridge
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Periodic Main work remains functional while sharing one scheduler tick instead of one interval per subsystem.
  - Non-interactive periodic work is stretched 4x while the runtime is shedding.
  - Subscribers watching the same filesystem root share one watcher handle and still receive the same events.
touchedAreas:
  - shared/resources/timer-aligner.ts
  - shared/resources/watcher-hub.ts
  - shared/resources/index.ts
  - electron/services/efficiency-sampler.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/services/resource-tracker.ts
  - electron/services/cron-maintenance.ts
  - openclaw_runtime/src/agents/utils/fs-watch.ts
  - openclaw_runtime/src/agents/modes/interactive/theme/theme.ts
  - openclaw_runtime/src/agents/sessions/footer-data-provider.ts
  - tests/unit/resource-timer-watcher.test.ts
  - tests/unit/resource-timer-shed-pressure.test.ts
  - tests/unit/resource-watcher-handle-pressure.test.ts
  - tests/unit/r0-3-cron-maintenance.test.ts
  - harness/specs/tasks/resource-timer-watcher-governance.md
  - harness/specs/fixtures/tf0400-timer-watcher/**
requiredTests:
  - tests/unit/resource-timer-watcher.test.ts
  - tests/unit/resource-timer-shed-pressure.test.ts
  - tests/unit/resource-watcher-handle-pressure.test.ts
  - tests/unit/r0-3-cron-maintenance.test.ts
acceptance:
  - Main live setInterval count drops by at least 50% against the captured 4-interval baseline.
  - A controlled real-fs-watcher workload drops handles by at least 60% when five subscriptions share two roots.
  - Shedding stretches non-interactive tasks 4x and the retained CPU sample drops by at least 30%.
  - Focused tests, typechecks, runtime build/typecheck boundary, harness validation, repository artifact retention, build:vite and an Electron smoke probe are recorded.
docs:
  required: false
---

# TF-0411 P3 Timer and Watcher Governance

## Objective

Implement the cooperative timer-aligner and root-keyed watcher-hub from the
Resource Fabric plan, adopt them on the bounded Main/runtime call sites, and
retain real interval/handle/CPU measurements rather than static estimates.

## Scope

- `TimerAligner`: one unref'd process interval, phase-aligned task registration,
  in-flight suppression, and 4x stretching for non-interactive tasks while shed.
- Main adoption: efficiency sampler, background-work gate, resource tracker and
  cron maintenance register tasks instead of owning intervals.
- `WatcherHub`: directory/file subscriptions keyed by normalized root/path,
  one backend watcher per key, event fan-out and handle-safe unsubscribe.
- Runtime adoption: generic agent `fs-watch` helper, theme watcher and footer
  Git watchers use the hub; more complex chokidar watchers remain explicitly
  out of this bounded adoption.

## Acceptance

- `pnpm exec vitest run tests/unit/resource-timer-watcher.test.ts tests/unit/resource-timer-shed-pressure.test.ts tests/unit/resource-watcher-handle-pressure.test.ts tests/unit/r0-3-cron-maintenance.test.ts` passes.
- `pnpm run typecheck:node`, `typecheck:web`, `typecheck:test` pass.
- `pnpm run build:vite` and the relevant runtime build/typecheck boundary pass.
- `pnpm harness validate --spec harness/specs/tasks/resource-timer-watcher-governance.md`, `pnpm repo:artifacts:check` pass.
- The fixture records a 4→2 Main interval sample, a 5→2 watcher-handle sample,
  and a shed CPU reduction of at least 30%.