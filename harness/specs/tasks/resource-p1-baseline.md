---
lifecycleStatus: active
id: resource-p1-baseline
title: Resource Fabric P1 Before Baseline (TF-0406)
type: task
intent: Capture a real five-minute Electron resource baseline before P1 caching and polling changes, while refusing to fabricate unavailable spawn or timer counts.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - contract-first-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - electron/services/efficiency-api.ts
  - electron/services/efficiency-orchestrator.ts
  - electron/services/efficiency-sampler.ts
  - shared/host-api/contract.ts
  - tests/unit/efficiency-sampling-panel.test.tsx
  - tests/unit/runtime-efficiency-api.test.ts
  - tests/unit/runtime-efficiency-sampler.test.ts
  - harness/specs/tasks/resource-p1-baseline.md
  - harness/specs/fixtures/tf0406-resource-baseline/**
---

# TF-0406 Resource Fabric P1 Before Baseline

## Objective

Record a real, candidate-bound five-minute idle baseline before P1 caching and
polling work. The baseline must preserve actual sampler values and must not
invent counters the current Main contract does not expose.

## Scope

- Expose the existing bounded raw efficiency samples through the read-only
  efficiency host-api contract.
- Keep manual captures visible in the bounded sample sequence before the next
  timer tick.
- Run a real Electron process for five minutes with the normal Main sampler.
- Keep process-spawn and live setInterval counts explicitly unavailable unless
  a real source counter exists. Static count or estimation is not accepted as
  measured runtime data.

## Acceptance

- `pnpm exec vitest run tests/unit/runtime-efficiency-sampler.test.ts tests/unit/runtime-efficiency-api.test.ts tests/unit/efficiency-sampling-panel.test.tsx` passes.
- `pnpm run typecheck` passes.
- `pnpm run build:vite` passes before the real Electron probe.
- `pnpm contract:check` passes.
- `pnpm harness validate --spec harness/specs/tasks/resource-p1-baseline.md` passes.
- `pnpm repo:artifacts:check` passes.
- The fixture contains the real probe, raw report, summary, acceptance receipt
  and `SHA256SUMS`; the report candidate matches the pre-edit HEAD.
- No P1 cache, poll-scheduler or caller behavior change is included.

## Notes

This is a before-side measurement only. It does not establish an after-side
improvement. Receipts are agent-driven.
