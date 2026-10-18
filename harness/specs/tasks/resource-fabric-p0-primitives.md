---
lifecycleStatus: active
id: resource-fabric-p0-primitives
title: Resource Fabric P0 Pure Primitives (TF-0403)
type: task
intent: Add six dependency-free resource scheduling primitives under shared/resources with deterministic injected clocks and no existing caller wiring.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - shared/resources/**
  - tests/unit/resource-fabric-primitives.test.ts
  - harness/specs/tasks/resource-fabric-p0-primitives.md
  - harness/specs/fixtures/tf0403-resource-primitives/**
---

# TF-0403 Resource Fabric P0 Pure Primitives

## Objective

Implement the P0 foundation from `docs/dev/resource-scheduling-plan-20261018.md`
without changing any existing runtime caller. These are pure in-memory helpers,
not a scheduler service, persistence layer, or second authority.

## Scope

- `bounded-cache.ts`: bounded LRU plus TTL and explicit invalidate.
- `singleflight.ts`: coalesce same-key in-flight work; failures do not poison later work.
- `adaptive-limit.ts`: deterministic Gradient2-style limit adjustment with a minimum-change dead zone.
- `token-bucket.ts`: injected-clock burst admission without sleeping.
- `priority-queue.ts`: interactive/background/opportunistic ordering, priority boost, and age promotion.
- `drf-share.ts`: DRF-lite dominant-share bookkeeping and a bounded fairness check.
- Every helper accepts caller-supplied clocks where time matters; no timers, I/O, Electron, Runtime or third-party dependencies.
- No existing caller is modified in this node. No persistence, IPC, host-api, UI or background loop is added.

## Acceptance

- Six modules exist under `shared/resources/` and are exported from a shared index.
- Unit tests cover normal paths, boundary conditions and failure behavior for every helper.
- `pnpm exec vitest run tests/unit/resource-fabric-primitives.test.ts` exits 0.
- `pnpm run typecheck:test` exits 0.
- `pnpm run typecheck` exits 0.
- `pnpm harness validate --spec harness/specs/tasks/resource-fabric-p0-primitives.md` exits 0.
- `pnpm repo:artifacts:check` exits 0.
- `git diff --check` exits 0.
- `package.json`, `pnpm-lock.yaml`, existing caller files and the Event/Task/Trace authorities are unchanged.

## Notes

This task is P0 only. P1 caching, P2 ResourceFabric wiring, P3 timer/watcher consolidation and P4 network/I/O work remain separate nodes. Receipts are agent-driven.
