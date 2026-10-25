---
id: model-capability-effective-runtime-state
title: Runtime effective state for ModelCapabilityProfile
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Bind ModelCapabilityProfile/v1 to the tools, drivers, grants, runtime acknowledgement, quarantine, memory and knowledge facts visible immediately before an embedded agent model call, without treating static disposition or local fallback as executable proof.
expectedUserBehavior:
  - The model receives a bounded capability-positioning addendum grounded in the current run instead of README or static catalog claims.
  - Missing, stale or generation-mismatched runtime acknowledgement leaves availability and drivers unknown.
  - Disabled, degraded, quarantined, expired and revoked states remain visible and fail closed.
  - A superseded refresh cannot inject an older profile into a newer model call.
touchedAreas:
  - harness/specs/tasks/model-capability-effective-runtime-state.md
  - harness/specs/fixtures/model-capability-effective-runtime-state/current-20261022/**
  - docs/architecture-overview.md
  - openclaw_runtime/src/agents/runtime-effective-capability.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-utils.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/reply/queue/types.ts
  - openclaw_runtime/src/auto-reply/templating.ts
  - openclaw_runtime/src/gateway/server-methods/chat.ts
  - tests/unit/runtime-effective-capability.test.ts
requiredRules:
  - backend-communication-boundary
  - prompt-cache-observation-boundary
  - capability-owner-resolution
  - runtime-authority-convergence-boundary
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-effective-capability.test.ts tests/unit/model-capability-profile.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Tool inventory, driver, runtime acknowledgement, grants, quarantine, memory and knowledge facts are refreshed immediately before prompt submission.
  - Runtime acknowledgement is trusted only when complete, fresh and matched to the process gateway generation.
  - Missing acknowledgement, unknown generation and fallback inventory produce unknown state rather than inferred availability.
  - Disabled, degraded, quarantined, expired and revoked facts are reflected without promoting static disposition.
  - The static digest ignores effective facts and observation time, while the effective digest changes with effective facts and remains stable for observation-only changes.
  - A stale run generation cannot overwrite or inject a newer prompt profile.
  - The final bounded prompt addition is assembled only after prompt hooks and runtime context composition.
  - Workspace identity travels from chat.send through FollowupRun and embedded-run parameters to the runtime profile scope.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# Runtime effective state for ModelCapabilityProfile

`ModelCapabilityProfile/v1` keeps static disposition, effective runtime availability, action authorization, memory and knowledge as separate axes. Static metadata contributes identity and intended positioning; it never changes runtime availability to `enabled`.

The embedded runner refreshes the profile after prompt hooks and runtime context have settled. It appends the bounded profile text to the final system prompt, immediately before the provider submission boundary. Raw model probes keep their exact prompt and skip this addition.

The runtime generation is the gateway restart generation stamped into the child process, while the run-local generation guard rejects late profile completions. A local runtime ack can describe the current child only when it is complete, fresh and stamped with a real matching gateway generation. A missing or `unknown` generation remains unverified.

Runtime memory and knowledge default to unverified facts. Configuration may prove a gate is off; it does not prove an enabled operation is executable. Component owners supply explicit memory, knowledge, grant, driver and quarantine facts as those sources mature.

## Evidence

Agent-driven evidence is stored under
`harness/specs/fixtures/model-capability-effective-runtime-state/current-20261022/`.
