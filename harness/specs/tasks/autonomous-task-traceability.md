---
id: autonomous-task-traceability
title: TF-0688 Query task provenance, effects, acceptance and attributed cost
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: dc5c44dca
intent: Connect existing Task events, checkout identities, usage observations and retained artifacts in one read-only task report.
ownedPaths: &paths
  - shared/task-system/identity.ts
  - shared/task-system/types.ts
  - shared/task-system/store.ts
  - shared/task-system/runtime.ts
  - shared/task-system/trace.ts
  - shared/host-api/contract.ts
  - shared/types/workspace.ts
  - electron/services/task-system-service.ts
  - electron/services/task-ledger-api.ts
  - electron/services/usage-api.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/execution-domain.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - src/lib/host-api.ts
  - src/components/task-ledger/TaskTracePanel.tsx
  - src/pages/TaskLedger/ManagedTasks.tsx
  - src/pages/TaskLedger/index.tsx
  - shared/i18n/locales/*/taskLedger.json
  - tests/unit/task-traceability.test.ts
  - tests/unit/task-trace-panel.test.tsx
  - tests/unit/task-model-usage.test.ts
  - tests/unit/usage-live-scope.test.ts
  - tests/unit/execution-domain-registry.test.ts
  - tests/e2e/autonomous-task-traceability.spec.ts
  - harness/specs/tasks/autonomous-task-traceability.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/fixtures/autonomous-project-system/v1/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
touchedAreas: *paths
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - durable-task-system-boundary
  - error-governance-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - A task card opens its source, execution, artifact and acceptance report from the existing Task Ledger.
  - Source revisions, missing events, replaced checkout identities and changed artifacts have explicit report diagnostics.
  - Usage totals preserve unknown amounts and identify estimated catalog prices; a session total never impersonates one run's usage.
acceptance:
  - Existing Task events retain each run and managed operation's original task revision, session generation, claim epoch and available checkout and binding identity. A delayed completion cannot adopt a later owner.
  - The read-only report joins goals, contracts, claims, runs, delegations, operations, candidates, checks, owner proofs and cleanup references. Missing references are visible, and caller expectations cannot bless an old contract or candidate.
  - Artifact checks use their original execution scope and existing Git retention receipts. Forged, altered, missing or stale artifacts cannot become current evidence, and source-session deletion leaves task acceptance available.
  - The existing model-call usage observer supplies task receipts without prompt text or credentials. Repeated observations are idempotent, conflicting receipts are diagnosed, and subtree costs count each original model-call receipt once instead of adding parent summaries.
  - Queue, execution, verification and recovery durations identify their actual owner-event boundaries. Missing boundaries remain unknown, and recovery or parent-child overlap cannot silently add execution twice.
  - Task Ledger exposes a keyboard accessible report with source, effects, costs, diagnostics and raw Task events, with en/zh/ja/ru locale coverage and bounded-width Electron screenshots.
  - The compiled Gateway journey produces a real file and owner verification, reads its task report after reload and session deletion, then detects artifact modification and old-source expectations.
  - Source, candidate, actor, commands, exits, counts, hashes and negative receipts are read from disk. Independent review uses the user-selected hy4flash-free Responses endpoint.
requiredTests:
  - pnpm exec vitest run tests/unit/task-traceability.test.ts tests/unit/task-model-usage.test.ts tests/unit/usage-live-scope.test.ts tests/unit/task-trace-panel.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/durable-task-runtime.test.ts tests/unit/durable-task-review.test.ts tests/unit/durable-task-faults.test.ts tests/unit/task-worktree-retention.test.ts tests/unit/execution-domain-registry.test.ts tests/unit/token-usage.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/autonomous-task-traceability.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomous-task-traceability.md
  - pnpm harness run --spec harness/specs/tasks/autonomous-task-traceability.md --dry-run
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

Task events remain the durable task owner. The report reads those events and
their existing effect, checkout and artifact owners; it introduces no trace,
cost or audit database. Model-call observations are retained as Task receipts
so deleting a conversation does not erase the acceptance chain or its recorded
cost. Catalog-derived amounts are estimates, and absent prices remain unknown.
