---
id: electron-test-process-lifecycle
title: Reclaim Electron processes after a Windows test worker crashes
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 80af349c4bb0624f4d81b5e971290deaf905d696
intent: Repair the reproduced orphan-process cleanup gap without claiming that an unreproduced native worker crash is fixed.
expectedUserBehavior:
  - Windows Electron tests leave no application from their own run after a worker aborts during launch.
  - Cleanup does not terminate applications owned by another test run or the user.
  - A failed worker still produces a failed test result and retained diagnostics.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - playwright.config.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/fixtures/electron-process-cleanup.ts
  - tests/e2e/electron-worker-cleanup.spec.ts
  - docs/dev/electron-test-process-lifecycle.md
  - harness/specs/tasks/electron-test-process-lifecycle.md
docs:
  required: true
  paths:
    - docs/dev/electron-test-process-lifecycle.md
requiredTests:
  - pnpm exec playwright test tests/e2e/electron-worker-cleanup.spec.ts tests/e2e/brand-logo.spec.ts tests/e2e/chat-memory-injection-panel.spec.ts tests/e2e/chat-manual-compaction.spec.ts tests/e2e/startup-loading-experience.spec.ts
  - pnpm run typecheck
  - pnpm agent-dev:deep-test
acceptance:
  - An agent-driven launch-abort regression demonstrates that the failed worker remains failed while its actual Electron process is reclaimed even after the Windows shell wrapper exits.
  - A live application with another run's profile remains running during cleanup.
  - Brand, memory panel, manual compaction and startup regressions pass without increasing retries, timeouts or screenshot tolerances.
  - Document the original native exit code, unsuccessful reproduction attempts, injected-fault boundary and exact fresh test results.
---

Windows Playwright launches Electron through a shell. Its exposed child PID
can exit before the real application, so PID-only cleanup is insufficient.
Use the existing test profile boundary to identify applications owned by a run.
This task changes test infrastructure only; product defaults and transport policy
remain unchanged. All fault injection and verification are agent-driven.
