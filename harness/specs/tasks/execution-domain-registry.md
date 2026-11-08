---
id: execution-domain-registry
title: Persist managed checkout identity and recover registration across restart
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c0868c76f7a583b7d8c809dff905f3ad29a0784f
intent: Extend the existing WorktreeService with SQLite ownership, creation intent, checkout incarnation and explicit local task-authority registration, preserving existing execution and cleanup owners.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - runtime-lifecycle-governance-boundary
  - durable-task-system-boundary
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Managed checkout ownership survives process restart and incomplete creation is visible.
  - Replaced paths cannot reuse old checkout credentials.
  - Independent clones remain independent until explicitly registered with an existing local task authority.
touchedAreas:
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/orchestration-worktree-merge.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry-lifecycle.ts
  - openclaw_runtime/src/gateway/session-resource-inventory.ts
  - openclaw_runtime/src/agents/worktree-registry.ts
  - openclaw_runtime/src/agents/execution-domain.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - tests/unit/execution-domain-registry.test.ts
  - tests/unit/worktree-registry-restart.test.ts
  - tests/unit/autonomy-worktree-owner.test.ts
  - tests/unit/orchestration-worktree-merge.test.ts
  - tests/fixtures/worktree-registry-process.ts
  - vitest.execution-domain.config.ts
  - harness/specs/tasks/execution-domain-registry.md
  - harness/specs/guides/execution-domain-registry.md
  - harness/specs/guides/unified-concurrent-development-management.md
  - harness/specs/fixtures/execution-domain-registry/**
  - harness/specs/fixtures/unified-concurrent-development/20261108/research-index.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredTests:
  - pnpm exec vitest run --config vitest.execution-domain.config.ts
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Creation intent, native creation, registration and readiness survive restart or expose an explicit incomplete state; unknown directories are retained.
  - Path aliases share one registry scope; replacement directories cannot inherit old incarnation or cleanup authority.
  - Same-common-dir identity remains compatible; explicit clone registration validates authority locator and revision and fails closed when unavailable.
  - Registry records are persisted through the existing shared Runtime SQLite owner; process-local caches never grant ownership.
  - Existing coordinator remains its sole writer; a documented migration contract prevents duplicate writes while the concurrent session-scope implementation is active.
docs:
  required: true
  files:
    - harness/specs/guides/execution-domain-registry.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This slice owns durable registration and observation. Joint effect admission and environment migration consume it in subsequent slices. Integration and reclamation remain existing owner operations.
