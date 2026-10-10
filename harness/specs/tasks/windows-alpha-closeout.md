---
lifecycleStatus: archived
id: windows-alpha-closeout
title: Verify and land the current Windows alpha candidate
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 61999fea2d16dfa9c708d59e8ba2e909fa35ff7a
intent: Complete the current candidate's full Windows regression and private-main landing, preserving explicit capability and platform boundaries.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Current Windows CLI and installer fixes retain their existing behavior through the complete desktop suite.
  - Stopping an unfinished Gateway start and then repairing configuration allows a new start; superseded startup cannot perform stale repair work.
  - Reported capability limits agree with executable behavior and do not imply cross-platform or unrestricted product acceptance.
touchedAreas:
  - .github/workflows/electron-e2e.yml
  - tests/unit/installer-nsh.test.ts
  - tests/e2e/fixtures/electron.ts
  - electron/gateway/manager.ts
  - electron/gateway/startup-orchestrator.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - harness/specs/tasks/windows-alpha-closeout.md
  - docs/dev/windows-alpha-closeout-20261008.md
  - artifacts/windows-alpha-closeout-20261008/report.json
  - artifacts/windows-alpha-closeout-20261008/credential-scan.json
  - artifacts/windows-alpha-closeout-20261008/SHA256SUMS
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - .gitignore
  - .gitattributes
docs:
  required: true
  paths:
    - docs/dev/windows-alpha-closeout-20261008.md
requiredTests:
  - pnpm exec vitest run tests/unit/installer-nsh.test.ts tests/unit/windows-delivery-entry.test.ts --maxWorkers=1
  - pnpm test
  - pnpm run typecheck
  - pnpm exec playwright test
  - pnpm run agent-dev:deep-test
  - pnpm run harness:ci
acceptance:
  - Record clean commit/tree identities and current full root-unit and Electron discovery, results, failures, skips, and process cleanup. Targeted repeats do not replace the full result.
  - Check all root and runtime production/test type projects, readonly lint, startup budgets, communication replay/comparison, and current Agent Dev evidence.
  - Configure the existing CI matrix with a whole-suite budget based on measured duration and required runtime/display prerequisites; retain per-test limits, assertions, retries and failure artifacts. Record service refusal or test failure explicitly; local Windows qualification does not establish a pass for other platforms.
  - Bind actual installer bytes and their source provenance to the qualification; retain earlier failed candidates and state-restoration records without rewriting them.
  - Verify existing CVK diagnostic and fixed-template PPTX boundaries and state exactly which migration/platform checks executed. Unexecuted platforms or scenarios are not passing evidence.
  - Land the verified source and curated evidence on the existing private main branch without deleting unrelated history, forcing refs, publishing, or changing product defaults.
  - Update local Task Forest and handoff from disk-backed evidence. Local task history stays out of Git.
---

This follows the owner's 2026-10-08 request to handle the remaining validation,
landing and capability-boundary points. The baseline is the clean Windows fix
candidate plus its retained report. Dependencies may be reused but source and
test identities must be recorded. New CVK enforcement or arbitrary PPTX pagination
belongs to a separately specified scope if the owner selects it. Running the
existing CI platform matrix supplies test evidence without expanding platform
release commitments or changing those contracts.
