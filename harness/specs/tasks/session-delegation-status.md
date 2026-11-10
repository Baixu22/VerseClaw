---
lifecycleStatus: active
id: session-delegation-status
title: Show delegation, execution, reporting and continuation as separate facts
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c308b60e1e8dc6849628c524ff8d8e1f0ce0a522
intent: Complete the existing session/task UI contract through owner-backed, generation-scoped results.
ownedPaths:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - shared/types/session-delegation.ts
  - shared/task-system/types.ts
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - shared/host-api/contract.ts
  - electron/services/sessions-api.ts
  - openclaw_runtime/src/gateway/server-methods/session-task-scope.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.read.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - openclaw_runtime/src/gateway/server-methods/optional-model-catalog.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts
  - electron/gateway/session-task-scope-bridge.ts
  - electron/utils/host-deadline-context.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-ledger-service.ts
  - electron/services/task-system-service.ts
  - electron/services/workspaces-api.ts
  - src/lib/host-api.ts
  - src/pages/TaskLedger/index.tsx
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/components/file-preview/WorkspaceSubagentPanel.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/stores/session-activity.ts
  - src/components/chat/SessionDelegationStatus.tsx
  - tests/unit/session-delegation-status.test.tsx
  - tests/unit/durable-task-session-scope.test.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/unit/session-task-scope-bridge.test.ts
  - tests/unit/gateway-worker-history-metadata.test.ts
  - tests/unit/gateway-session-active-runs.test.ts
  - tests/unit/task-ledger-snapshot-cache.test.ts
  - tests/unit/chat-send-input-mode.test.ts
  - tests/unit/session-chain-panels.test.tsx
  - tests/unit/workspace-agents-panel-failure.test.tsx
  - tests/unit/session-handoff-recovery.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/session-worker-task-journey.spec.ts
  - tests/e2e/fixtures/electron.ts
  - harness/specs/tasks/session-delegation-status.md
  - shared/i18n/locales/**/chat.json
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - shared/types/session-delegation.ts
  - shared/host-api/contract.ts
  - electron/services/sessions-api.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-system-service.ts
  - electron/services/workspaces-api.ts
  - src/lib/host-api.ts
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
  - src/components/file-preview/WorkspaceSubagentPanel.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/stores/session-activity.ts
  - src/components/chat/SessionDelegationStatus.tsx
  - tests/unit/session-delegation-status.test.tsx
  - tests/unit/durable-task-session-scope.test.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/unit/session-chain-panels.test.tsx
  - tests/unit/workspace-agents-panel-failure.test.tsx
  - tests/unit/session-handoff-recovery.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/session-worker-task-journey.spec.ts
  - harness/specs/tasks/session-delegation-status.md
  - shared/i18n/locales/**/chat.json
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - session-derivation-ui-contract
  - i18n-locale-coverage
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - durable-task-system-boundary
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Admission, actual execution, report delivery, task acceptance and parent continuation remain distinct.
  - Current session/workspace/generation scopes reject stale results and unavailable owner actions.
  - Read failures stay visible and preserve draft, transcript and evidence references.
acceptance:
  - Apply the complete U4 contract from session-derivation-ui-design and TF-0660, retaining all nine original criteria.
  - Use canonical host actions and current owner receipts; do not infer task acceptance from text or a finished run.
  - Worker details read the canonical task for the displayed child generation; pending, accepted and cancelled remain separate from run completion. Task read failures preserve the transcript and show unavailable acceptance.
  - Delegated effects accept a generation-matching canonical parent reference when its navigation link has not yet been written; task identity, generation and writer fencing remain required.
  - File verification, submission and the existing verifier owner produce a real accepted task before either worker surface displays acceptance. Four locales use task-specific labels.
  - Recorded cost comes from structured usage in the loaded transcript; absent or null costs display unknown, while a supplied zero remains zero.
  - Worker admission uses its own child receipt; its canonical task comes from the generation-fenced owner read. Verification records retain task revision, epoch and candidate separately from task acceptance.
  - Generation-fenced worker history reads use message-only Gateway requests and render before the independent task-owner query finishes.
  - Fenced worker history uses the existing Gateway request budget, clamped by the caller's logical deadline, so a concurrent parent history read does not impose a separate ten-second limit.
  - Worker navigation, intervention recovery and coordinator isolation run as separate Electron cases while retaining the complete original journey assertions.
  - Worker intervention acceptance checks the held run and queued run terminal owners before transcript readback; queue drain receipts remain distinct from run completion. Control and coordinator-isolation cases use a 420-second overall budget while retaining bounded host, queue, history and generation checks.
  - Canonical Task Ledger reads skip a contended derived snapshot-cache refresh without waiting on its write lock; explicit cache writes retain serialization, and event or Task owner read failures still reject the read.
  - A queued worker message rejected by the chat owner remains recoverable in the original queue with the rejection recorded; it is not marked drained.
  - Session describe and list share the tracked-run owner projection; retained terminal abort entries stay available for idempotency without keeping a finished worker active.
  - Task Ledger worker links use runtime source facts to open the existing transcript surface under the correct coordinator.
  - Four-locale Electron journeys and focused negative tests identify the same candidate and agent actor.
requiredTests:
  - pnpm exec vitest run tests/unit/chat-send-input-mode.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/task-ledger-snapshot-cache.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/gateway-session-active-runs.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run typecheck:test
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/session-derivation-ui.spec.ts --workers=1
  - pnpm exec vitest run tests/unit/session-delegation-status.test.tsx tests/unit/session-chain-panels.test.tsx tests/unit/workspace-agents-panel-failure.test.tsx tests/unit/durable-task-session-scope.test.ts tests/unit/session-task-scope-completion.test.ts tests/unit/session-task-scope-bridge.test.ts tests/unit/host-deadline.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec playwright test tests/e2e/session-worker-task-journey.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/session-delegation-status.md
  - pnpm harness run --spec harness/specs/tasks/session-delegation-status.md --dry-run
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/modules/multi-agent-and-tasks.md
---

The original session UI contract remains the acceptance source. Its required cases
are retained in the aggregate journey inventory; this spec only narrows ownership.
