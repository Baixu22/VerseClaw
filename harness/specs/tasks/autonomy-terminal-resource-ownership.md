---
id: autonomy-terminal-resource-ownership
title: Enforce owned process capacity, port reservation and terminal scope
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: dee28c8a2
intent: Extend the existing managed process capacity and terminal owners with host-shared reservations, declared port admission and generation-scoped control, retaining native termination receipts.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - runtime-lifecycle-governance-boundary
  - disk-temp-policy
  - docs-sync
  - comms-regression
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-reservation.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - electron/services/terminal-session-manager.ts
  - electron/services/terminal-api.ts
  - electron/services/resource-tracker.ts
  - electron/services/web-preview-manager.ts
  - electron/services/web-preview-api.ts
  - electron/main/ipc-handlers.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - src/components/file-preview/WorkspaceTerminalPanel.tsx
  - tests/unit/terminal-api.test.ts
  - tests/e2e/workspace-terminal-panel.spec.ts
  - tests/unit/terminal-session-manager.test.ts
  - tests/unit/terminal-resource-ownership.test.ts
  - tests/unit/terminal-resource-native.test.ts
  - tests/unit/web-preview-startup-recovery.test.ts
  - tests/unit/web-preview-owner-api.test.ts
  - tests/unit/fixtures/terminal-resource-worker.mts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.real-limits.test.ts
  - vitest.terminal-resources.config.ts
  - vitest.terminal-resources.native.config.ts
  - harness/specs/tasks/autonomy-terminal-resource-ownership.md
  - harness/specs/guides/terminal-resource-ownership.md
  - harness/specs/fixtures/autonomous-project-system/r3/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Multiple workspaces share the declared managed process capacity.
  - Declared server ports reject overlapping managed launches before process creation.
  - Terminal input and control reject stale or mismatched owner identities.
acceptance:
  - Declared capacity is atomic across processes and workspaces; unknown process outcomes retain occupancy until an owner proves termination.
  - Port reservation is acquired before launch and released only with the native lifecycle; external bind failures are diagnosed without adopting or killing another process.
  - PTY generation and owner scope prevent cross-task input and stale reuse.
  - Native Windows cancellation, deadlines, restart and owner exit preserve termination/cleanup receipts; output truncation retains artifact references and standard Windows environment.
  - Current evidence distinguishes real process effects, mocks and historical baseline; original defaults and product locks remain unchanged.
requiredTests:
  - pnpm exec vitest run --config vitest.terminal-resources.config.ts
  - pnpm exec vitest run --config vitest.terminal-resources.native.config.ts
  - pnpm run test:e2e tests/e2e/workspace-terminal-panel.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
docs:
  required: true
  files:
    - harness/specs/guides/terminal-resource-ownership.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

TF-0681 consumes existing instance capacity, process supervisor/ACI ownership and terminal control. It does not replace ResourceFabric/adaptive scheduling, TaskSystemStore or RecoveryAuthority.
