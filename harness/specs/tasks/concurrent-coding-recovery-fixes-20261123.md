---
lifecycleStatus: active
id: concurrent-coding-recovery-fixes-20261123
title: Repair concurrent coding startup and recovery boundaries
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 215420159848583895e1eb8ce9c244a47fb0677e
intent: Repair the four reproduced startup, receipt replacement, cleanup retry and executor reset defects from the 2026-11-23 concurrent coding audit.
touchedAreas:
  - electron/utils/verseshell-runtime-bundle.ts
  - electron/services/versegit-lifecycle.ts
  - shared/versegit-cleanup-barrier.ts
  - openclaw_runtime/src/agents/subagent-versegit-cleanup.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.test.ts
  - openclaw_runtime/src/agents/verseshell/concurrent-acquisition.integration.test.ts
  - tests/unit/verseshell-runtime-bundle.test.ts
  - tests/unit/versegit-completion-lifecycle.test.ts
  - tests/unit/versegit-cleanup-barrier.test.ts
  - tests/unit/versegit-candidate-receipts.test.ts
  - tests/fixtures/versegit-receipt-replacement.mts
  - harness/specs/rules/verseshell-process-lifecycle-boundary.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/tasks/concurrent-coding-recovery-fixes-20261123.md
  - harness/specs/fixtures/concurrent-coding-recovery/20261123/**
  - docs/modules/verse-tools.md
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - verseshell-process-lifecycle-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - The host accepts the qualified two-patch VerseShell bundle and rejects modified provenance.
  - Failed receipt replacement preserves the previous record and its epoch fence.
  - A transient stop or drain failure can resume cleanup under the same run identity after authoritative readback.
  - Clearing the operator kill switch permits a fresh executor after the previous executor is confirmed stopped.
requiredTests:
  - pnpm exec vitest run tests/unit/verseshell-runtime-bundle.test.ts tests/unit/versegit-completion-lifecycle.test.ts tests/unit/versegit-cleanup-barrier.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/versegit-candidate-receipts.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts src/agents/verseshell/process-manager.test.ts src/agents/verseshell/concurrent-acquisition.integration.test.ts src/agents/verseshell/governed-process.test.ts src/agents/verseshell/managed-process-capacity.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/concurrent-coding-recovery-fixes-20261123.md
acceptance:
  - Startup validates the tracked qualified source identity and its exact patch stack; unknown or modified source identities still fail.
  - Injected rename failure leaves completion and cleanup records readable; a fresh store rejects an older epoch and can retry the valid update.
  - A cleanup retry rechecks transient drain and reference conditions without authorizing identity drift, live processes or changed resources.
  - Repeated kill-switch cycles create a new usable executor, fence pending acquisitions and leave no owned test PIDs after shutdown.
  - Test reports retain original failures and final counts, bind source hashes, and label protocol substitutes and real filesystem/process observations accurately.
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/verse-tools.md
  note: README.md, README.zh-CN.md and README.ja-JP.md retain the existing feature entry points; recovery semantics are documented in the module guide.
---

The audit input is `D:/tmp/concurrent-coding-audit-20261123-452f499c0/REPORT.json`.
Implementation uses one isolated checkout based on `215420159`; Task Forest ownership remains
with the main repository. Source qualification, product defaults and the native executor contract
retain their existing owners.

## Cleanup fixture correction

The prior cleanup fixtures expected uncommitted worker changes to be deleted. The current
WorktreeService intentionally rejects that deletion; the original failures are preserved in
the audit report and this run's `red-host` and `native-candidate` reports. The corrected fixtures
first prove dirty refusal, then commit results to shared refs before cleanup and read those
results back afterward. Candidate verification still proves the same failed-to-passing execution
and receipt checks. This changes fixture preparation and retention assertions, not the resource
owner's deletion policy.
