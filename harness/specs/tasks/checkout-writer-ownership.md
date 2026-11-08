---
id: checkout-writer-ownership
title: Persist exclusive checkout writers and fence maintenance races
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: eeb4578ecab8dab1bca285907c652ba3287170a7
intent: Extend the existing WorktreeService owner with durable exclusive write claims, operation receipts and drain checks; use the same claims for merge, candidate freeze and cleanup.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - runtime-lifecycle-governance-boundary
  - disk-temp-policy
  - docs-sync
  - comms-regression
touchedAreas:
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-writer.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/fixtures/checkout-writer-worker.mts
  - vitest.checkout-writer.config.ts
  - harness/specs/tasks/checkout-writer-ownership.md
  - harness/specs/guides/checkout-writer-ownership.md
  - harness/specs/fixtures/checkout-writer-ownership/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - A managed checkout cannot be merged, frozen or deleted while a writer or unresolved effect holds it.
  - Restart, lease expiry and path reuse never transfer ownership to a new writer automatically.
acceptance:
  - Two processes cannot acquire different writers for the same native checkout; independent roots can proceed concurrently.
  - Writer epoch and checkout incarnation reject stale operations, including after release and recreation at the same path.
  - In-flight or unknown operations block release and maintenance; expiry closes admission and never frees ownership.
  - Existing merge, candidate freeze and cleanup execute within owner-issued maintenance claims, and interrupted effects remain recoverable.
  - The parent joint-admission task retains its TaskSystemStore/session/binding/Mission/tool-entry acceptance; this resource slice does not grant task execution authority.
requiredTests:
  - pnpm exec vitest run --config vitest.checkout-writer.config.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
docs:
  required: true
  files:
    - harness/specs/guides/checkout-writer-ownership.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This independently verifiable resource-owner slice is a child of joint admission.
It preserves the parent's unresolved dependency on the active session task-scope line.
Main/coordinator and TaskSystemStore files remain with their current implementation owners.
