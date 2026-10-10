---
lifecycleStatus: archived
id: runtime-security-verification-shadow-mvp
title: Runtime security and verification shadow MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a backend-only, feature-flagged shadow validation layer for Gateway-visible tool calls so security and verification decisions can be observed without changing legacy execution behavior.
touchedAreas:
  - harness/specs/tasks/runtime-security-verification-shadow-mvp.md
  - openclaw_runtime/src/security-verification-shadow/**
  - openclaw_runtime/src/gateway/tools-invoke-shared.ts
  - openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/observability/types.ts
  - shared/types/observability.ts
  - electron/services/workspace-permissions.ts
  - tests/unit/security-verification-shadow.test.ts
expectedUserBehavior:
  - Existing tool invocation, approval waiting, error, retry, and return payload behavior remains unchanged when the shadow layer is disabled.
  - When the shadow layer is enabled, users still see the same tool execution behavior; security and verification decisions are only observable through backend RPC and observability records.
  - No new renderer UI, user-facing copy, or active tool blocking is introduced in this MVP.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
acceptance:
  - Security and verification shadow evaluation is default-off and can be enabled without changing tools.invoke response shapes, approval waiting semantics, error mapping, retries, or delivery ordering.
  - Shadow records are held in a bounded in-memory Gateway/runtime buffer and are lost on Gateway restart.
  - Gateway exposes read/simulate methods under security.* and verification.* through the existing JSON-RPC method descriptor and Host API path.
  - Shadow records include a sanitized runId for batch correlation; list/status RPCs expose deterministic summary counts and support filtered result reads without changing legacy tool execution behavior.
  - A regression fixture covers the full simulate -> verification.run -> results.list/filter -> results.get -> intercepts.list -> summary flow.
  - Observability additions are additive and sanitized; no raw prompt, complete tool args, or complete tool output is stored.
  - The MVP does not run external lint/typecheck/test commands, call an LLM judge, write Role Memory/Knowledge, or actively block tools.
requiredTests:
  - pnpm run verify:security-shadow-mvp
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Runtime Security and Verification Shadow MVP

This MVP is a backend-only shadow layer. It observes or simulates runtime tool-call security and verification decisions, but it does not enforce those decisions.

The first implementation only records Gateway-visible `tools.invoke` calls when the feature flag is enabled. Agent-internal tool execution remains on the legacy path and is reserved for a follow-up active interceptor task.

Security decisions are deterministic: dangerous command patterns would block, shell/exec-like tools would require approval, mutating/network/sensitive-key calls warn, and everything else allows. Verification decisions are deterministic: failed/denied tool results fail, cancelled results warn, missing result/evidence/trace context is insufficient evidence or warning, and otherwise pass.

Shadow data is bounded, sanitized, process-local, and reset on Gateway restart.
Result reads can be correlated by `runId` and summarized by security decision,
verification status, source, and finding counts so the validation layer can act
as a backend health signal without running external tests.

Run `pnpm run verify:security-shadow-mvp` before extending this MVP. The verifier
executes harness context, harness validation, focused shadow-layer unit tests,
the RPC regression fixture, typecheck, and comms replay/compare in one sequence.
