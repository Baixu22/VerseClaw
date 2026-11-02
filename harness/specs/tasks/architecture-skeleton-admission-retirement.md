---
lifecycleStatus: active
id: architecture-skeleton-admission-retirement
title: Admission A5 — retire all 43 flat IPC channels and the preload invoke door
type: task
intent: Remove the 43 adjudicated flat ipcMain channels and the remaining preload invoke surface so renderer request/response traffic has exactly one typed path, host:invoke, while preserving event subscriptions and the real window/notification behavior.
requiredProfiles:
  - fast
requiredRules:
  - contract-first-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - docs-sync
  - task-forest-autoclose-and-roles
  - agent-engineering-acceptance-boundary
ownedPaths:
  - harness/specs/tasks/architecture-skeleton-admission-retirement.md
  - electron/main/ipc-handlers.ts
  - electron/main/ipc/request-helpers.ts
  - electron/preload/index.ts
  - electron/services/system-notifications-api.ts
  - electron/services/window-api.ts
  - src/types/electron.d.ts
  - scripts/contract-check.mjs
  - scripts/contract-check-flat-ipc.json
  - tests/unit/contract-check.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/system-notifications-api.test.ts
  - tests/fixtures/contract-check/**
  - docs/dev/architecture-skeleton/ADMISSION-GATE.md
requiredTests:
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/contract-check.test.ts
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts
  - pnpm exec vitest run tests/unit/system-notifications-api.test.ts
  - pnpm run test:e2e tests/e2e/startup-loading-experience.spec.ts
  - pnpm run test:e2e tests/e2e/settings-drawer.spec.ts
  - pnpm run test:e2e tests/e2e/chat-file-changes.spec.ts
acceptance:
  - electron/main/ipc-handlers.ts contains 0 ipcMain.handle sites; across the repository the only ipcMain.handle registration is electron/main/ipc/host-invoke.ts for host:invoke.
  - electron/preload/index.ts exposes no ipcRenderer.invoke wrapper and contains no literal invoke channel except verseClaw.hostInvoke('host:invoke'); on/once/off and hostInvoke behavior remain intact.
  - pnpm contract:check passes, and negative fixtures prove that adding one ipcMain.handle or one direct preload invoke wrapper fails through the real gate entry.
  - scripts/contract-check-flat-ipc.json retains all 43 adjudications as retired with retirement.commit provenance; docs/dev/architecture-skeleton/ADMISSION-GATE.md records the retirement.
  - pnpm run typecheck passes; changed-file eslint has 0 warnings; contract, host-api facade, and system-notification unit tests pass; startup, settings, and chat smoke E2E exit codes are recorded.
  - git diff against shared/host-api/contract.ts, src/lib/host-api.ts, and electron/main/ipc/host-invoke.ts is 0; no permission path, Host API action, default value, or product lock is added.
nonGoals:
  - Do not change event channels, webContents.send, HOST_EVENT_CHANNELS, or preload on/once/off semantics.
  - Do not change host:invoke sender authentication, HostApiRegistry, or any Host API action.
  - Do not change product defaults, permission paths, release state, or approval semantics.
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/ADMISSION-GATE.md
readmeUpdates: not-required
---

# Admission A5 — flat IPC retirement

## Why

A1–A4 made the flat channels observable, migrated their live renderer and E2E consumers,
and proved the typed facade is the only intended request path. The remaining handlers
and the preload `electronAPI.ipcRenderer.invoke` door are compatibility residue: they
keep a second, string-addressed request surface alive after its consumers are gone.

This task retires that surface without changing event delivery or any typed action.

## Retirement shape

- Delete every `ipcMain.handle` registration from `electron/main/ipc-handlers.ts`.
- Delete the unified `app:request` dispatcher and its now-dead request helpers.
- Keep `electron/main/ipc/host-invoke.ts` as the sole `ipcMain.handle` site.
- Remove `ipcRenderer.invoke` from `electronAPI`; retain `on`/`once`/`off` and
  `verseClaw.hostInvoke`.
- Keep the 43 adjudications in `scripts/contract-check-flat-ipc.json` as retirement
  provenance instead of erasing history.
- Make the gate distinguish active compatibility entries from retired channels and
  reject any retired channel that becomes live again.

## Runtime repair found during retirement

The typed `window.syncTrafficLightPosition` call was registered on
`createSystemNotificationsApi`, whose implementation was a no-op, while the legacy flat
handler performed the real macOS traffic-light update. Retirement therefore includes a
minimal repair: the registered typed service calls `syncMacTrafficLightPosition`, with a
focused unit test. The unused duplicate `window-api.ts` scaffold is removed.

## Verification

- `pnpm contract:check`
- `pnpm run typecheck`
- focused unit tests for contract-check, host-api facade, and system notifications
- Electron smoke specs for startup, settings, and chat with exact exit codes
- changed-file ESLint and `git diff --check`
- `git diff` checks for the three protected typed-entry files

All commands and verdicts are agent-driven (`driven_by: agent`); no human evidence is
claimed.
