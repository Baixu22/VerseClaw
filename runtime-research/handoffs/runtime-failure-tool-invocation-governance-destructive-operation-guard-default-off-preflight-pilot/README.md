# Runtime Failure Tool Invocation Governance Destructive Operation Guard Default-Off Preflight Pilot

Status: default_off_preflight_pilot_not_production_ready.

## Scope

This Phase D handoff implements the accepted default-off `destructive_operation_guard` preflight pilot.

The only active owner is mutation-capable tool invocation preflight:

```text
openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
```

The implementation adds a runtime-core decision helper and wires it into `runBeforeToolCallHook` before plugin hook and trusted policy early returns. The helper consumes explicit sanitized preflight candidate metadata only.

## Flag

The pilot flag is:

```text
runtime.toolGovernance.destructiveOperationGuard.preflight.enabled
```

Semantics:

- omitted means disabled
- `false` means disabled
- schema validation accepts only boolean values
- only explicit boolean `true` enables the pilot
- flag-off returns an allow decision with `legacyBehavior: true`
- flag-off rollback requires no migration or state cleanup

## Trigger Boundary

Flag-on blocking requires all accepted trigger metadata at the same time:

- owner is `mutation_capable_tool_invocation_preflight`
- tool invocation is mutation-capable
- candidate rule is exactly `destructive_operation_guard`
- candidate tool name matches the normalized tool name
- deleted touched-path metadata is present
- `wrong_file_edit` or `unnecessary_edit` scorecard metadata fails
- Phase 5 metadata includes `futureActiveCandidate.action = "block"`
- `requiresAcceptedSpec = true`
- false-block corpus metadata is passing

Deleted touched-path metadata alone is not sufficient. Phase 5 future candidate metadata alone is not sufficient. Broad shell command pattern blocking is not allowed.

## Non-Owners

The following surfaces do not own or consume the pilot decision:

- TaskLoop
- provider transport
- Gateway payloads and server methods
- prompt/model-message assembly
- replay harness
- scorecard helpers
- governance advisory generation
- evidence proof helpers
- retry, approval, rollback, and completion
- checkpoint and lifecycle authority state
- Electron main/services/preload
- renderer pages, components, stores, and lib surfaces
- scripts, daemons, services, listeners, databases, exporters, schedulers, and always-on sidecars

## Validation Summary

Focused unit coverage lives in:

```text
tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
tests/unit/runtime-feature-config-schema.test.ts
```

Coverage includes flag-off legacy behavior, flag-on block behavior, non-preflight/non-mutation/missing-candidate allow paths, deleted-path-only false-block protection, sanitized diagnostics, config schema strictness, and automated boundary scans.

## Stop Line

This phase stops after the default-off pilot implementation. It does not expand the holdout corpus, approve production/default-on behavior, or begin Phase E.
