# Synthesis

Status: default_off_preflight_pilot_not_production_ready.

## Decision

Phase D implements a default-off `destructive_operation_guard` preflight pilot. The pilot is active only when `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` is explicit boolean `true`.

This phase does not approve default-on behavior, production rollout, or Phase E holdout expansion.

## Accepted Implementation Shape

- Concrete owner path: `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`.
- Concrete owner function: `runBeforeToolCallHook`.
- Runtime helper: `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts`.
- Config flag: `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
- Flag-off behavior: allow with `legacyBehavior: true`.
- Flag-on behavior: block only a fully evidence-qualified `destructive_operation_guard` candidate for a mutation-capable tool invocation.
- Candidate source: explicit sanitized preflight candidate metadata supplied through hook context.
- Replay, scorecard, governance advisory, and evidence proof helpers remain offline evidence producers and are not invoked by the active preflight path.

## Safety Properties

The pilot cannot block when:

- the flag is omitted or false
- owner is not mutation-capable tool invocation preflight
- tool invocation is not mutation-capable
- candidate metadata is missing
- candidate tool name does not match the normalized tool name
- replay, scorecard, or touched-path provenance refs are missing
- deleted touched-path metadata appears without Phase 5 future block metadata
- deleted touched-path metadata appears without failing `wrong_file_edit` or `unnecessary_edit`
- false-block corpus metadata is not passing

Diagnostics include only sanitized refs and bounded strings. Raw prompts, provider payloads, tool args/results, secrets, environment dumps, and unredacted workspace content are not retained by the helper.

## Boundary Result

Focused automated boundary coverage allows only these runtime matches:

```text
openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts
openclaw_runtime/src/runtime-core/index.ts
```

The scan denies active owner references in TaskLoop, ACP, Gateway, auto-reply, channels, plugin SDK, tasks, Electron main/services, renderer `src`, and scripts.

## Rollback

Rollback is disabling or omitting `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`. This restores legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup.

Deleting the pilot is also mechanical: remove the helper, the hook context/import/evaluation call, the config schema entries, tests, this spec/handoff package, and parent doc entries.

## Stop Line Preserved

No TaskLoop decision, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion behavior, checkpoint/lifecycle authority state, Electron service, renderer behavior, default tool behavior, live provider read, real workspace mutation proof, broad shell pattern block, service, daemon, listener, database, exporter, scheduler, or Phase E holdout expansion is introduced.
