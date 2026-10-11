---
id: p1-issue-fixes-batch1-20261010
title: P1 issue batch 1 - provider errors, Retry-After and host error metadata
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close open P1 issues #116, #117, #118 and #119 at the shared runtime/host boundaries without changing product defaults, provider endpoints or permission policy.
expectedUserBehavior:
  - Every known provider failover reason has an explicit OpenAI-compatible response, and a Chat SSE failure is never rendered as a normal stop with fabricated zero usage.
  - Provider error messages and codes exposed over compatible JSON/SSE are redacted and bounded, including SDK errors that bypass transport-level sanitization.
  - Retry-After is a lower bound; an unsatisfiable hint stops before another request and preserves the original failure metadata.
  - Renderer host-api failures preserve the Main error code, request correlation id and structured details, so TIMEOUT/permission/rate-limit classification does not depend on message English.
touchedAreas:
  - openclaw_runtime/src/agents/provider-http-errors.ts
  - openclaw_runtime/src/gateway/openai-compat-errors.ts
  - openclaw_runtime/src/gateway/openai-http.ts
  - openclaw_runtime/src/gateway/openresponses-http.ts
  - openclaw_runtime/src/infra/retry.ts
  - src/lib/host-api-client.ts
  - src/lib/error-model.ts
  - src/lib/user-error.ts
  - electron/main/ipc/host-invoke.ts
  - tests/unit/provider-error-retry-boundaries.test.ts
  - tests/unit/provider-error-http-boundaries.test.ts
  - tests/unit/host-api-client-error-metadata.test.ts
  - tests/unit/host-invoke.test.ts
  - tests/unit/error-model.test.ts
  - tests/unit/user-error.test.ts
  - tests/unit/error-governance-boundary.test.ts
  - scripts/check-error-governance.mjs
  - harness/specs/rules/error-governance-boundary.md
  - harness/specs/rules/provider-error-retry-boundaries.md
  - docs/dev/error-governance-decision-record.md
  - docs/dev/p1-issue-fixes-batch1-20261010.md
  - harness/specs/tasks/p1-issue-fixes-batch1-20261010.md
requiredRules:
  - backend-communication-boundary
  - error-governance-boundary
  - provider-error-retry-boundaries
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/provider-error-retry-boundaries.test.ts tests/unit/provider-error-http-boundaries.test.ts tests/unit/host-api-client-error-metadata.test.ts tests/unit/host-invoke.test.ts tests/unit/error-model.test.ts tests/unit/error-governance-boundary.test.ts --maxWorkers=1
  - node scripts/check-error-governance.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch1-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Issue #116 - all 15 FailoverReason values are covered by an exhaustive typed mapping; refusal is refusal_error/422, unknown is api_error/500 without assigning responsibility, and an unmapped Chat SSE failure emits a structured error event rather than assistant stop plus measured zero usage.
  - Issue #117 - public provider messages and codes are passed through mandatory redaction and the existing bounded preview before JSON/SSE serialization; custom/off logging redaction cannot disable the public boundary.
  - Issue #118 - invokeHost preserves the echoed request id, maps Main/provider codes through the existing renderer classifier, carries safe structured details, and records bridge rejection/renderer timeout; Main normalizes nested code/status signals into the existing HostErrorCode envelope.
  - Issue #119 - finite non-negative Retry-After is treated as a lower bound; hints beyond maxDelayMs or the platform timer limit stop before onRetry/sleep/re-execution and rethrow the original error; satisfiable hints use positive-only jitter.
  - Evidence is synthetic/agent-driven only: no real credential, paid provider call, desktop installation, cross-platform or full-system acceptance claim.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch1-20261010.md
---

# P1 issue batch 1

This batch closes four open P1 issues that share one property: a failure is
allowed to lose its meaning at a boundary. #116 loses the failover reason at the
Chat SSE fallback, #117 loses the redaction/budget guarantee at the final error
boundary, #118 loses the structured host error metadata in the renderer, and
#119 lets a local retry cap override an upstream lower bound.

The change reuses the existing error envelope, provider-error redaction,
failover taxonomy and retry runner. It does not add a second error envelope,
change retry defaults, open or close a product flag, call a paid provider, or
claim real-human evidence. Verification is synthetic and agent-driven.
