---
id: phase-a-sandbox-truth-20261012
title: Correct sandbox capability claims, tool-result truncation, and sandbox denial classification
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Keep declared sandbox capabilities truthful, preserve both prompt head and failure tail in tool-result caps, and make an actual sandbox-gate refusal a typed error that maps into the existing error taxonomy.
expectedUserBehavior:
  - The Windows-light provider no longer advertises restricted-token because no shipped implementation or readback establishes that capability.
  - Oversized tool results keep a useful prefix and the error-bearing suffix instead of dropping the tail.
  - Browser, cron, terminal and gateway denials raised by the sandbox gate carry mechanism/operation/provider diagnostics; browser/cron use the typed error and terminal/gateway expose a sandboxDenial result field.
touchedAreas:
  - electron/utils/sandbox-provider-detection.ts
  - shared/types/sandbox.ts
  - shared/agent-resource-limits.ts
  - shared/sandbox/errors.ts
  - shared/host-api/contract.ts
  - electron/main/ipc/host-invoke.ts
  - electron/services/agent-browser-api.ts
  - electron/services/cron-api.ts
  - electron/services/terminal-api.ts
  - electron/services/gateway-api.ts
  - electron/services/git-api.ts
  - src/lib/error-model.ts
  - tests/unit/agent-resource-limits-p5-004.test.ts
  - tests/unit/sandbox-api.test.ts
  - tests/unit/sandbox-denial-error.test.ts
  - tests/unit/host-invoke.test.ts
  - tests/unit/versebrowser-host-adapter.test.ts
  - tests/unit/cron-api-browser-automation.test.ts
  - tests/unit/terminal-api.test.ts
  - tests/unit/gateway-permissions-api.test.ts
  - tests/unit/git-api.test.ts
  - tests/unit/error-model.test.ts
  - harness/specs/tasks/phase-a-sandbox-truth-20261012.md
  - harness/specs/rules/error-governance-boundary.md
  - docs/dev/error-governance-decision-record.md
requiredRules:
  - error-governance-boundary
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/agent-resource-limits-p5-004.test.ts tests/unit/sandbox-api.test.ts tests/unit/sandbox-denial-error.test.ts tests/unit/host-invoke.test.ts tests/unit/versebrowser-host-adapter.test.ts tests/unit/cron-api-browser-automation.test.ts tests/unit/terminal-api.test.ts tests/unit/gateway-permissions-api.test.ts tests/unit/git-api.test.ts tests/unit/error-model.test.ts --maxWorkers=1
  - node scripts/check-error-governance.mjs
  - pnpm run typecheck
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-a-sandbox-truth-20261012.md
acceptance:
  - windows-light advertises workspace-readonly, workspace-readwrite and the actually wired process-limits capability, and does not advertise restricted-token.
  - capToolResultText preserves both ends of an oversized result, keeps the configured character ceiling, and retains a final error/stack marker.
  - SandboxDenialError carries mechanism, optional path, operation and provider context; SANDBOX_DENIED maps to the existing PERMISSION AppError code.
  - Host invoke preserves the whitelisted sandbox diagnostic fields in HostResponse details without creating a new envelope or HostErrorCode union; terminal/gateway blocked results carry the same structured denial details.
  - The change does not claim that the Job Object is a security sandbox or that Seatbelt/Landlock detection is already wired.
docs:
  required: false
---

# Phase A sandbox truthfulness and tool-result tail preservation

This is a focused honesty and diagnosability change. It removes a capability claim that had no shipped implementation/readback, changes tool-result truncation to head+tail, and adds an internal domain error for refusals that the sandbox gate actually raises today.

The new error maps into the existing `AppError` taxonomy and `HostResponse` details. It is not a second envelope, not a new `HostErrorCode`, and does not claim OS-level Seatbelt/Landlock enforcement before those mechanisms exist.
