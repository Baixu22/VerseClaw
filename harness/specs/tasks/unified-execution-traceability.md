---
lifecycleStatus: active
id: unified-execution-traceability
title: Preserve task evidence through concurrent checkout recovery and cleanup
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: de9790a08
intent: Complete TF-0867 using the existing Task events, execution-domain registration, checkout writer and Git object owners.
ownedPaths: &paths
  - shared/git-native-root.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - electron/services/git-api.ts
  - electron/services/task-system-service.ts
  - electron/services/session-storage-api.ts
  - shared/task-system/**
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/execution-task-barrier.ts
  - openclaw_runtime/src/agents/execution-domain.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-writer.ts
  - openclaw_runtime/src/agents/worktree-merge-files.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - tests/unit/task-artifact-retention.test.ts
  - tests/unit/task-worktree-retention.test.ts
  - tests/unit/git-api.test.ts
  - tests/unit/ui-worktree-cleanup-conservative.test.ts
  - tests/unit/session-storage-api.test.ts
  - tests/unit/worktree-reclamation-preservation.test.ts
  - tests/unit/checkout-writer-ownership.test.ts
  - tests/unit/execution-migration.test.ts
  - tests/unit/fixtures/task-retention-worker.mts
  - tests/e2e/unified-execution-traceability.spec.ts
  - tests/e2e/u6-interaction-metrics.final.spec.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - tests/unit/chat-input.test.tsx
  - harness/specs/tasks/unified-execution-traceability.md
  - harness/specs/tasks/r4-reclamation-preservation-increment.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/rules/session-derivation-ui-contract.md
  - harness/specs/fixtures/unified-execution-traceability/**
  - harness/specs/fixtures/autonomous-project-system/r4/reclamation-increment/**
  - docs/modules/multi-agent-and-tasks.md
  - docs/modules/workspace-and-coding.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - disk-temp-policy
  - docs-sync
  - comms-regression
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Completed results remain traceable after their execution checkout is reclaimed.
  - Cleanup preserves exact historical artifacts before releasing their path references.
  - Handoff waits for the current session identity before preparing its draft; hydration preserves pending sidebar intent while reset and navigation discard stale results.
  - Task creation, authority registration and deletion serialize on the same execution-domain barrier.
acceptance:
  - Two sessions compete, A executes, migration crashes, B continues, stale A is refused, an exact candidate is accepted, and A is safely reclaimed.
  - Different tasks competing for one tree, independent clones, external edits, reused paths, claim/delete races and missing or conflicting receipts have concrete negative evidence.
  - Original Task events retain target, actor, run, binding, candidate, inputs, checks and receipts; retained artifact bytes can be read after deleting the source tree.
  - Baseline and candidate use identical journey drivers and frozen measurement methods for actions, latency, resources, recovery, failure and unknown results.
  - Four locales and Electron evidence distinguish source builds, installed packages and owner effects from controlled fixtures; an independent agent reads the final artifacts.
requiredTests:
  - pnpm exec vitest run tests/unit/task-artifact-retention.test.ts tests/unit/task-worktree-retention.test.ts tests/unit/checkout-writer-ownership.test.ts tests/unit/execution-domain-registry.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/ui-worktree-cleanup-conservative.test.ts tests/unit/worktree-reclamation-preservation.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/unified-execution-traceability.spec.ts --workers=1
  - pnpm exec playwright test tests/e2e/chat-session-handoff.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/unified-execution-traceability.md
  - pnpm harness run --spec harness/specs/tasks/unified-execution-traceability.md --dry-run
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

Task history and Git snapshots retain distinct authority. The Task owner appends
artifact-retention and cleanup receipts without rewriting checkpoints or evidence.
Git retains the exact bytes under a stable shared ref. Cleanup verifies those bytes
again and leaves active claims, delegations and unresolved effects blocking.

Lock order is the existing worktree registry lock, sorted execution-domain bakery
locks, Task SQLite transaction, then short execution-state transactions. Registration
acquires the same domain locks before its execution-state transaction. An absent
Task database is covered by the domain barrier. Persisted cleanup bindings point to
the original authority, enabling completion after removal or process interruption.

Original A4/U1–U6 criteria remain in session-task-chain-acceptance. TF-0867's five
criteria above add integration proofs and do not replace those requirements.
