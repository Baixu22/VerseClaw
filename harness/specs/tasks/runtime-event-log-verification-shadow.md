---
id: runtime-event-log-verification-shadow
title: Runtime event log and checkpoint verification shadow
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend the backend-only verification shadow layer from single tool-call validation to deterministic runtime event-log and checkpoint validation without running external commands or changing legacy execution behavior.
touchedAreas:
  - harness/specs/tasks/runtime-event-log-verification-shadow.md
  - harness/specs/tasks/runtime-security-verification-shadow-mvp.md
  - openclaw_runtime/src/security-verification-shadow/**
  - openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/security-verification-shadow.test.ts
  - tests/unit/security-verification-shadow-contract.test.ts
  - scripts/verify-security-shadow-mvp.mjs
expectedUserBehavior:
  - Existing tool invocation, approval, retry, error, and return payload behavior remains unchanged.
  - `verification.run` can validate `request/result`, `events`, or `checkpoint` inputs in shadow mode.
  - Event-log and checkpoint verification only emits sanitized in-memory records and RPC summaries; no UI, active blocking, external tests, or LLM judge is introduced.
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
  - Shadow records include `subject: tool_call | event_log | checkpoint`.
  - Tool-call records retain the existing sanitized request/result contract.
  - Event-log records use runtime-core replay diagnostics and store only sanitized event counts, task/trace ids, replay status, diagnostic counts/codes, and aggregate counts.
  - Checkpoint records use runtime-core checkpoint deserialization diagnostics and store only sanitized checkpoint ids/status/counts and diagnostic counts/codes.
  - `verification.run` accepts either `events` or `checkpoint` but not both; existing request/result behavior remains compatible.
  - `verification.results.list` and `security.intercepts.list` support subject/runId/source/decision/status filters and return matching summaries.
  - Records and observability data do not persist raw prompt, full event payloads, full checkpoint payloads, complete tool args, or complete tool output.
requiredTests:
  - pnpm run verify:security-shadow-mvp
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# Runtime Event Log and Checkpoint Verification Shadow

This task extends the existing security/verification shadow MVP into a runtime
validation adapter. The adapter remains backend-only and deterministic. It
validates runtime task event arrays through `replayRuntimeTaskEvents` and
checkpoint snapshots/JSON through `deserializeRuntimeCheckpoint`.

The adapter does not execute tests, lint, typecheck, shell commands, or model
judges. It only validates runtime shape, replay/checkpoint diagnostics, evidence
counts, and correlation metadata.

The required regression fixture covers:

1. `security.policy.simulate` does not record results.
2. `verification.run` records sanitized `tool_call`, `event_log`, and
   `checkpoint` subjects.
3. `verification.results.list` supports subject/runId/source/decision/status
   filters and returns filtered summaries.
4. `verification.results.get` returns sanitized records.
5. `security.intercepts.list` returns matching sanitized records and summaries.
6. `verification.status` exposes aggregate health counts.
