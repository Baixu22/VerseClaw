---
lifecycleStatus: active
id: unified-acceptance-fixture-refresh
title: Keep unified acceptance and activity reads bound to the current session generation
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 2d039348684b71c5e3772e97ac0f38046b7c4095
intent: Refresh the original U6 aggregate fixtures while retaining its 64 criteria and the five TF-0867 criteria.
ownedPaths: &paths
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/modules/multi-agent-and-tasks.md
  - harness/specs/rules/session-derivation-ui-contract.md
  - harness/specs/rules/autonomy-session-task-scope-boundary.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - electron/services/sessions-api.ts
  - electron/services/workspaces-api.ts
  - electron/services/workspace-runtime-sync.ts
  - openclaw_runtime/src/gateway/session-utils.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/gateway/server-methods/session-active-runs.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.workspace-binding.test.ts
  - src/components/chat/SessionFamilyNavigation.tsx
  - src/components/chat/ResourceChip.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/use-new-chat-action.ts
  - src/components/task-ledger/TaskLedgerSummaryPanel.tsx
  - src/lib/workspace-session.ts
  - src/stores/workspaces.ts
  - src/stores/gateway.ts
  - tests/unit/gateway-store-status-snapshot.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - harness/specs/tasks/unified-gateway-snapshot-readback.md
  - harness/specs/rules/gateway-readiness-policy.md
  - shared/host-api/contract.ts
  - tests/unit/workspace-session.test.ts
  - tests/unit/workspace-runtime-sync.test.ts
  - tests/unit/session-family-navigation.test.tsx
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
  - tests/e2e/chat-workspace-header.spec.ts
  - tests/e2e/session-lifecycle-recovery.spec.ts
  - tests/e2e/session-family-counter-layout.spec.ts
  - tests/e2e/session-task-reading-navigation.spec.ts
  - tests/e2e/session-delegation-capacity.spec.ts
  - tests/e2e/u6-interaction-metrics.final.spec.ts
  - tests/e2e/fixtures/session-task-chain.ts
  - tests/unit/session-chain-fixture-batching.test.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/autonomy-host-readiness.spec.ts
  - tests/e2e/visual-tune.spec.ts
  - tests/e2e/fixtures/electron-executable.ts
  - tests/e2e/fixtures/electron-process-cleanup.ts
  - tests/unit/electron-executable.test.ts
  - tests/unit/electron-process-identity.test.ts
  - tests/unit/electron-window-size.test.ts
  - tests/unit/resource-chip-activity-readback.test.tsx
  - tests/unit/dcs-preview-switch.test.ts
  - docs/agent-dev-control-plane.md
  - tests/e2e/fixtures/windows-process.ts
  - harness/specs/guides/long-session-delegation-admission.md
  - harness/specs/tasks/unified-acceptance-fixture-refresh.md
  - harness/specs/tasks/unified-active-workspace-config.md
  - harness/specs/tasks/autonomy-task-actions.md
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/tasks/autonomy-host-readiness.md
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
  - local-data-fail-closed-config
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Session mutations carry the current physical generation and retain recoverable state on failure.
  - Delegation uses a live task claim; task acceptance remains separate from worker completion.
  - Lifecycle operations retain their original workspace and retry operation identity.
acceptance:
  - Workspace directory and permission updates share the existing configuration mutex with model writers and read the current active project after acquiring that lock.
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
  - Coordinator workspace binding uses sessions.patch with a backend caller and the current session generation; it preserves the existing transcript and session identity.
  - Directory changes reject visible and hidden current-generation runs and in-flight admissions; the existing admission fence remains held until the session metadata transaction commits.
  - Both directory identities are resolved before comparison; same-directory aliases can bind without disturbing an active run.
  - Replaced navigation and workspace selection are rejected before saving or activating the former source session.
  - Manual compression remains disabled until the current physical session generation is available; recovery journeys wait for that owner identity before dispatching their unchanged failure controls.
  - Coordinator binding persists its paused workspace intent before Runtime or task selection effects; lost replies and failed activation writes recover the same revision and generation through the existing binding owner.
  - Empty task scope remains reachable, source navigation retains its timestamp, and family counts remain visible while expanded; all display text uses the existing four locales.
  - Coordinator worker navigation uses the existing workspace session queue; the selected child is persisted without replacing the project coordinator anchor, and remains visible as the selected Sidebar row.
  - Worker receipts without a child session key remain visible and cannot activate navigation; actual navigation errors use the existing coordinator alert.
  - Sidebar and slash-command new-session actions flush the current view's pending draft through the existing workspace save queue before the owner receives a create request; refusal retains that saved source view.
  - New-session actions on another project persist the source draft, create within the requested project's owner, and activate only after successful creation; a superseded or disposed view cannot submit its old draft.
  - Expanded-family layout checks retain the visible count and verify its title separation at two, twenty and one hundred children in light, dark and narrow windows.
  - Paired journeys select the same real action in the baseline direct toolbar and the candidate More menu; performed UI events remain the source of unchanged operation metrics.
  - Each new isolated Electron test profile receives an available Gateway port, and a relaunch retains the profile's saved port without changing product defaults.
  - Cleanup compares registered PID creation times against the native process census before opening a process handle, so a protected process that reuses an old PID is identified without selecting it for termination.
  - Child-session fixture preparation creates at most four independent sessions per batch, waits for every creation response, and saves confirmed drafts serially through the existing Workspace owner in child order. The original counts, labels, and acceptance time limits remain fixed.
  - Paired crash recovery consumes the already-validated TF-0662 restart path from bb8541ba6: the known Host start timeout and eventual Gateway readiness are recorded separately before reading back the original generation and objective.
  - Source E2E launches may select a byte-identical staged Electron runtime through the existing G4 executable resolver; explicit per-test executables take precedence.
  - Window sizing selects the visible live window, waits for restored window state and measured renderer dimensions, and reports the actual size after minimum-size clamping; zero or unchanged wide/narrow captures cannot satisfy the coordination journey.
  - Renderer measurement uses the remaining resize deadline and rechecks window identity and native dimensions after the read; CSS viewport assertions convert through the owning window's zoom factor.
  - DCS Preview regression checks use its three registered preview flags; enabling or disabling the preview preserves the advanced stale-write guard's current opt-in setting.
  - Paired baseline inputs permit only the declared transitive executable resolver alongside the five measured helpers; both sides retain identical dependency bytes and reject other input changes.
  - Opening the resource popover reads the current session's activity owner through the existing store even when background status polling has stopped.
  - Cleanup reports launch markers remaining on disk after native process checks and removal, retains the detected count, and preserves markers when process discovery is unavailable.
requiredTests:
  - pnpm exec vitest run tests/unit/workspace-runtime-sync.test.ts tests/unit/atomic-config-write-p5-001.test.ts tests/unit/r0-2-models-json-lock.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/dcs-preview-switch.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/electron-window-size.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/resource-chip-activity-readback.test.tsx tests/unit/session-activity-store-scope.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/electron-executable.test.ts tests/unit/electron-process-identity.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/session-chain-fixture-batching.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/checkpoints-dialog.test.tsx --maxWorkers=1
  - pnpm exec vitest run tests/unit/vite-config-openclaw-runtime.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/session-handoff-recovery.test.ts tests/unit/long-session-coordinator-binding.test.ts tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/session-generation-freshness.test.ts tests/unit/long-session-completion-continuation.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/session-activity.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts src/gateway/server-methods/sessions.workspace-binding.test.ts --maxWorkers=1
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
  - pnpm exec playwright test tests/e2e/long-session-coordination.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/unified-acceptance-fixture-refresh.md
  - pnpm harness run --spec harness/specs/tasks/unified-acceptance-fixture-refresh.md --dry-run
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/agent-dev-control-plane.md
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
