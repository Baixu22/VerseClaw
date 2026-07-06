# Runtime Coupling Readiness

Status: ready_for_future_preflight_owner_only_not_runtime_production.

## Allowed Future Coupling

Future coupling is permitted only through mutation-capable tool invocation preflight ownership.

The current accepted owner remains:

```text
mutation_capable_tool_invocation_preflight
```

Any other owner, including TaskLoop, Gateway, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle authority state, Electron services, renderer code, or scripts, is rejected.

## Readiness Meaning

Readiness means the design path is bounded enough for a later separate accepted spec to consider future coupling. It does not mean:

- production/default-on ready
- default blocking approved
- active runtime owner expansion approved
- scorecard or shadow summary output can be treated as completion proof

## Rollback

Rollback remains flag-disable or helper removal only. Omitted or false `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` values preserve legacy allow behavior and require no migration or state cleanup.

