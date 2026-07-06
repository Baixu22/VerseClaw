# Synthesis

Status: controlled_runtime_component_available_default_off_not_default_on.

## Decision

The `destructive_operation_guard` line is now usable directly in runtime as a controlled default-off preflight component.

This is not a production/default-on approval. It is a runtime componentization result with strict owner and flag boundaries.

## Runtime Use

Use the runtime-core entrypoint:

```text
evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent
```

The only accepted active owner remains:

```text
mutation_capable_tool_invocation_preflight
```

The only enabling flag remains:

```text
runtime.toolGovernance.destructiveOperationGuard.preflight.enabled
```

Omitted or false flag values preserve legacy allow behavior.

## Component Positioning

Layer: runtime-core tool-governance preflight.

The component is not a TaskLoop policy engine, Gateway policy, provider transport policy, prompt/model-message policy, retry/approval/rollback/completion policy, UI feature, persistence writer, service, daemon, listener, database, exporter, or scheduler.

Entry boundary: the public component entrypoint does not accept caller-supplied owner. Ownership is fixed internally to mutation-capable tool invocation preflight, and denied-root imports remain disallowed.

The low-level evaluator is module-internal and is not exported as a second public runtime entrypoint.

## Stop Line

Do not use this component from TaskLoop, Gateway, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle authority state, Electron, renderer, scripts, services, daemons, listeners, databases, exporters, or schedulers.

Do not default it on.
