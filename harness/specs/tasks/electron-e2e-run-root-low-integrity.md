---
lifecycleStatus: active
id: electron-e2e-run-root-low-integrity
title: Honor caller E2E run root on low-integrity Windows checkouts
type: task
scenario: identity-scope-compatibility
taskType: test-infrastructure
diffBase: 5a9f340f726f5dc9dc496b9f42c38f1ea5aad9c3
intent: Prevent Playwright global setup from replacing a caller-selected low-integrity-safe E2E run root with an OS-temp child that the spawned Electron main process cannot write.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
expectedUserBehavior:
  - A caller can place isolated Electron profiles under an ignored in-checkout scratch directory on a low-integrity Windows checkout and reach the main window.
  - The runner still creates a unique cleanup boundary per Playwright run.
  - The default OS-temp behavior remains unchanged when no caller base is supplied.
docs:
  required: true
  paths:
    - docs/dev/electron-test-process-lifecycle.md
    - harness/specs/rules/disk-temp-policy.md
touchedAreas:
  - electron/main/index.ts
  - tests/e2e/fixtures/electron-process-cleanup.ts
  - docs/dev/electron-test-process-lifecycle.md
  - harness/specs/rules/disk-temp-policy.md
  - harness/specs/tasks/electron-e2e-run-root-low-integrity.md
  - harness/specs/fixtures/electron-e2e-run-root-low-integrity/**
requiredTests:
  - node node_modules/@playwright/test/cli.js test tests/e2e/structural-loading-pilot.spec.ts --reporter=list
  - pnpm run typecheck
  - pnpm exec eslint electron/main/index.ts tests/e2e/fixtures/electron-process-cleanup.ts
acceptance:
  - Electron 40.8.4 reaches create-window-browser-window-done and the rendered Settings page under a caller-selected ignored run root.
  - The focused structural-loading spec passes both cases with no retries, and process cleanup reports no survivors.
  - `electron-process-run.json` records both the caller baseRoot and a unique verse-claw-e2e-run child.
  - Typecheck exits 0; the touched TypeScript files have no ESLint errors.
  - The behavior remains E2E/test-infrastructure only and changes no product defaults, transport policy, or product locks.
notes:
  - Windows Playwright requires Node >= 24.16.0.
  - Run root and trace paths must be under the low-integrity-writable checkout scratch directory on this host.
---