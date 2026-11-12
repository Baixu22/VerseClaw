---
lifecycleStatus: active
id: unified-acceptance-fixture-refresh
title: Keep unified acceptance and activity reads bound to the current session generation
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ebcf5b317905f77706d6bf6abfd6700998352c58
intent: Refresh the original U6 aggregate fixtures while retaining its 64 criteria and the five TF-0867 criteria.
ownedPaths: &paths
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/modules/multi-agent-and-tasks.md
  - harness/specs/rules/session-derivation-ui-contract.md
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - openclaw_runtime/src/gateway/session-utils.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.test.ts
  - tests/unit/session-generation-freshness.test.ts
  - tests/unit/session-handoff-recovery.test.ts
  - tests/unit/long-session-coordinator-binding.test.ts
  - tests/unit/host-services.test.ts
  - src/pages/Chat/index.tsx
  - tests/unit/checkpoints-dialog.test.tsx
  - vite.config.ts
  - tests/unit/vite-config-openclaw-runtime.test.ts
  - tests/e2e/chat-checkpoints.spec.ts
  - tests/e2e/chat-manual-compaction.spec.ts
  - tests/e2e/chat-session-compact-range.spec.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - tests/e2e/long-session-completion-continuation.spec.ts
  - tests/e2e/long-session-coordination.spec.ts
  - tests/e2e/long-session-delegation-admission.spec.ts
  - tests/e2e/long-session-lifecycle-faults.spec.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - tests/e2e/session-task-scope-completion.spec.ts
  - tests/e2e/session-context-recovery.spec.ts
  - tests/e2e/session-delegation-capacity.spec.ts
  - tests/e2e/fixtures/session-task-chain.ts
  - harness/specs/guides/long-session-delegation-admission.md
  - harness/specs/tasks/unified-acceptance-fixture-refresh.md
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - autonomy-session-task-scope-boundary
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
  - Session mutations carry the current physical generation and retain recoverable state on failure.
  - Delegation uses a live task claim; task acceptance remains separate from worker completion.
  - Lifecycle operations retain their original workspace and retry operation identity.
acceptance:
  - Fork and Handoff regression journeys open the current session menu through its existing header control and retain the original action and rejection assertions.
  - Chat passes the active session generation to its checkpoint dialog; restoring a checkpoint sends that exact generation through the Host API.
  - Electron Main bundles local media-core imports from checked-in runtime sources, so startup does not require a root node_modules copy of that private workspace package.
  - Handoff pins the runtime child generation while creation is pending; interrupted activation remains creating, a missing or reset confirmed child is rejected before replacement, and ready is published after activation succeeds.
  - Activity snapshots read the persisted session generation after reset even when the session-store cache still contains the previous generation; deleted-agent discovery obeys the same fresh-read option.
  - Current run and capability projections select only a registered run captured in that persisted generation; stale runs cannot acquire the replacement session identity.
  - All original 73 aggregate Electron cases are retained, with failures and skipped cases reported separately.
  - Positive context and Handoff fixtures provide a current session generation and verify the scoped request.
  - Delegation fixtures create and claim a real task in an isolated project before admission and preserve restart, rejection and completion-batch assertions.
  - Archive fixtures identify a real assigned workspace; delete transport failures reuse the persisted operationId.
  - Visual fixtures wait for measured viewport dimensions; response-loss injection occurs only after committed Handoff creation.
  - Continuation verifies the public run-terminal receipt and a successful tool receipt before Handoff; missing or rejected effects cannot count as success.
requiredTests:
  - pnpm exec vitest run tests/unit/checkpoints-dialog.test.tsx --maxWorkers=1
  - pnpm exec vitest run tests/unit/vite-config-openclaw-runtime.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/session-handoff-recovery.test.ts tests/unit/long-session-coordinator-binding.test.ts tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/session-generation-freshness.test.ts tests/unit/long-session-completion-continuation.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/session-activity.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run build:runtime
  - pnpm exec playwright test tests/e2e/chat-checkpoints.spec.ts tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-session-compact-range.spec.ts tests/e2e/chat-session-handoff.spec.ts tests/e2e/long-session-completion-continuation.spec.ts tests/e2e/long-session-delegation-admission.spec.ts tests/e2e/long-session-lifecycle-faults.spec.ts tests/e2e/runtime-lifecycle-governance.spec.ts tests/e2e/project-agent-entry.spec.ts tests/e2e/session-task-scope-completion.spec.ts --workers=1
  - pnpm exec playwright test tests/e2e/session-context-recovery.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/unified-acceptance-fixture-refresh.md
  - pnpm harness run --spec harness/specs/tasks/unified-acceptance-fixture-refresh.md --dry-run
docs:
  required: true
  readmeTranslations: required
  files:
    - harness/specs/guides/long-session-delegation-admission.md
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

The authoritative acceptance remains in `session-task-chain-acceptance` and
`unified-execution-traceability`. This maintenance spec binds the changed fixtures
and their checks. Final aggregate results retain one candidate identity, raw failed
attempts, native cleanup receipts, and the shared measurement inputs.
