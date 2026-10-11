---
id: provider-error-retry-boundaries
title: P1 provider error redaction and Retry-After lower bounds
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix issues 117 and 119 at their shared runtime boundaries without changing product defaults or expanding the error-governance program.
expectedUserBehavior:
  - Provider errors exposed over compatible HTTP and SSE are redacted and bounded to 500 characters.
  - Retry-After is never shortened to fit a local retry cap; an unsatisfiable hint stops retries with the original error metadata.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - provider-error-retry-safety
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/agents/provider-http-errors.ts
  - openclaw_runtime/src/gateway/openai-compat-errors.ts
  - openclaw_runtime/src/gateway/openai-http.ts
  - openclaw_runtime/src/gateway/openresponses-http.ts
  - openclaw_runtime/src/infra/retry.ts
  - tests/unit/provider-error-retry-boundaries.test.ts
  - tests/unit/provider-error-http-boundaries.test.ts
  - harness/specs/tasks/provider-error-retry-boundaries.md
  - harness/specs/rules/provider-error-retry-boundaries.md
  - docs/dev/provider-error-retry-boundaries.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
residualPaths:
  - .gitignore
  - electron/main/index.ts
  - docs/dev/error-governance-audit-2026-10-09.md
  - docs/dev/harness-gap-closure/design.md
  - docs/dev/repository-cleanup-triage-2026-10-08.md
  - docs/dev/security-reality-audit-20261009.md
  - docs/dev/windows-runtime-efficiency-observability.md
  - electron/services/efficiency-orchestrator.ts
  - electron/services/efficiency-power-policy.ts
  - electron/services/efficiency-sampler.ts
  - harness/specs/rules/runtime-efficiency-observability-boundary.md
  - harness/specs/tasks/harness-gap-closure-plan.md
  - harness/specs/tasks/windows-runtime-efficiency-observability-v1.md
  - scripts/validate-runtime-efficiency.mjs
  - tests/unit/agent-trace-graph-layout-bench.test.ts
  - tests/unit/runtime-efficiency-power-policy.test.ts
  - tests/unit/runtime-efficiency-sampler.test.ts
docs:
  required: true
  paths:
    - docs/dev/provider-error-retry-boundaries.md
requiredTests:
  - pnpm exec vitest run tests/unit/provider-error-retry-boundaries.test.ts tests/unit/provider-error-http-boundaries.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/provider-error-retry-boundaries.md
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Synthetic api_key and Bearer content cannot escape the compatible error message or code; messages obey the existing 500 character limit.
  - Auth, billing, format, nested causes, generic failures, JSON and SSE paths retain safe classifications and diagnostic context.
  - Fake timers cover Retry-After below, equal to and above the cap, fractions, invalid hints, timer overflow and jitter endpoints.
  - A channel retry_after of 120 seconds stops without a second request under the unchanged 30 second cap.
  - Normal backoff, attempt counts and strict shouldRetry continue to work; rejected operations retain their original retry metadata.
  - Evidence is agent-driven and synthetic; no claim of real-human, paid-provider, desktop or full-system acceptance is made.
---

## Scope

Reuse provider error redaction and existing retry runners. Do not change retry defaults,
product locks, provider credentials or the separate issue 116 error taxonomy/SSE fallback contract.

## Concurrent workspace residuals

The exact residualPaths above belong to pre-existing/concurrent audits, runtime efficiency
and harness-gap work. They are not owned, changed or accepted by this task. They remain
visible to the diff-aware gate; no --no-diff, wildcard residual or product lock change is used.
The mandatory fast profile is retained for formal validation; its full suite is not claimed
by focused development tests or a Harness dry run.
