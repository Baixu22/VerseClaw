---
lifecycleStatus: active
id: resource-p1-cache-poll-takeover
title: Resource Fabric P1 Read-Only Cache and Poll Scheduler (TF-0405)
type: task
intent: Cache low-risk git status reads, invalidate them after successful writes, and route renderer polling through a visibility-aware scheduler without adding a second authority.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - contract-first-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - electron/services/git-api.ts
  - electron/services/system-api.ts
  - shared/types/resources.ts
  - src/lib/poll-scheduler.ts
  - src/lib/read-only-query-cache.ts
  - src/pages/Billing/index.tsx
  - src/pages/Browser/index.tsx
  - src/pages/Cron/index.tsx
  - src/pages/Skills/index.tsx
  - src/stores/resource-tracker.ts
  - tests/unit/git-api.test.ts
  - tests/unit/resource-p1-schedulers.test.ts
  - harness/specs/tasks/resource-p1-cache-poll-takeover.md
  - harness/specs/fixtures/tf0405-p1-evaluation/**
---

# TF-0405 Resource Fabric P1 Takeover

## Objective

Take over low-risk read-only query paths and renderer polling with the existing
resource primitives. Git status gets a bounded short-TTL cache and singleflight;
successful writes invalidate only their repository prefix. Renderer poll loops
share one visibility-aware scheduler and never issue overlapping work.

## Scope

- Git status is read-only cached for 5 seconds with a 16-entry bound.
- Concurrent identical status reads coalesce; rejected loads are not cached.
- Successful Git writes invalidate the status cache for the current repo.
- Renderer polling pauses while the page is hidden and supports background/
  interactive QoS and shed checks in the scheduler primitive.
- The existing sandbox provider detector's 15-second cache remains the owned
  probe cache; no second provider detector is introduced.

## Acceptance

- `pnpm exec vitest run tests/unit/git-api.test.ts tests/unit/resource-p1-schedulers.test.ts` passes.
- `pnpm run typecheck:test` passes.
- `pnpm run typecheck:node` passes.
- `pnpm contract:check` passes.
- `pnpm harness validate --spec harness/specs/tasks/resource-p1-cache-poll-takeover.md` passes.
- `pnpm repo:artifacts:check` passes.
- The fixture contains a task-level receipt, reusable probe, README and SHA256SUMS.
- The node does not claim the TF-0398 milestone spawn-count target; real spawn
  and live interval counts remain owned by TF-0421.
