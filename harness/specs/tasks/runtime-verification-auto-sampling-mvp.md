---
id: runtime-verification-auto-sampling-mvp
title: Runtime verification auto-sampling MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add default-off runtime event-log/checkpoint auto-sampling into the backend-only security/verification shadow layer, with deterministic health levels and no enforcement or user-visible UI.
touchedAreas:
  - harness/specs/tasks/runtime-verification-auto-sampling-mvp.md
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/security-verification-shadow/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - tests/unit/security-verification-shadow.test.ts
  - tests/unit/runtime-verification-auto-sampling.test.ts
  - tests/unit/runtime-event-log-store.test.ts
  - tests/unit/runtime-checkpoint-serializer.test.ts
  - scripts/verify-security-shadow-mvp.mjs
expectedUserBehavior:
  - Existing tool invocation, task-loop, checkpoint serialization, approval, retry, error, and return payload behavior remains unchanged.
  - Runtime event-log/checkpoint sampling is default-off and records only sanitized in-memory shadow summaries when explicitly enabled.
  - `verification.status`/health summaries expose `healthLevel: healthy | degraded | failing` for backend consumers.
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
  - Runtime event-log append paths can feed sanitized `event_log` verification records through an observe-only sampler when `runtime.eventLog.shadow` or an explicit sampling option is enabled.
  - Runtime checkpoint serialization can feed sanitized `checkpoint` verification records through an observe-only sampler when `runtime.checkpointSerializer.shadow` or an explicit sampling option is enabled.
  - Sampling failures are swallowed and cannot change runtime results, diagnostics, or payload shapes.
  - Default-off behavior records nothing without explicit runtime shadow flags/options.
  - Summary/status include `healthLevel`, where verification failures are `failing`, would-block or insufficient-evidence findings are `degraded`, and clean summaries are `healthy`.
  - Records remain process-memory bounded ring-buffer entries and do not persist raw prompts, raw event payloads, complete checkpoint payloads, complete tool args, or complete tool output.
requiredTests:
  - pnpm run verify:security-shadow-mvp
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Runtime Verification Auto-Sampling MVP

This task closes the next backend-only validation loop by wiring runtime-core
event-log/checkpoint producers into the existing security/verification shadow
record buffer. It remains an observe-only sampling layer: no active blocking, no
external test command, no LLM judge, no database migration, no sidecar files,
and no renderer/UI changes.

The intended integration points are:

1. `RuntimeTaskEventLogStore.append(...)` samples appended canonical events when
   explicit shadow sampling is enabled.
2. Task-loop event-log dual-write passes sampling options when the existing
   Phase-4 `runtime.eventLog.shadow` flag is enabled.
3. `serializeRuntimeCheckpoint(...)` samples the canonical checkpoint snapshot
   when explicit shadow sampling is enabled.
4. Security/verification status and summaries expose a deterministic
   `healthLevel` suitable for later dashboards or CI gates.
