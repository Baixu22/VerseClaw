# Destructive Operation Guard Controlled Runtime Componentization

Status: controlled_runtime_component_available_default_off_not_default_on.

## Direct Conclusion

`destructive_operation_guard` can now be used directly in runtime as a controlled default-off preflight component.

Allowed use:

- owner: `mutation_capable_tool_invocation_preflight`
- entrypoint: `evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent`
- flag: `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`
- layer: runtime-core tool-governance preflight
- default behavior: omitted or false flag preserves legacy allow behavior
- entry tightening: the public component entrypoint does not accept caller-supplied owner; ownership is fixed internally

Not allowed:

- default-on production rollout
- active ownership outside mutation-capable tool invocation preflight
- TaskLoop, Gateway, provider, prompt/model-message, retry, approval, rollback, completion, checkpoint/lifecycle, Electron, renderer, scripts, services, daemons, listeners, databases, exporters, or schedulers as consumers

## Implementation

The runtime-core preflight pilot now exposes stable component metadata:

- runtime component id
- schema version
- runtime-core tool-governance preflight layer
- default-off status
- accepted owner
- caller-supplied owner disabled
- flag path
- production/default-on non-approval
- active owner expansion non-approval

The before-tool-call hook calls the component entrypoint instead of assembling low-level evaluator input inline.

The low-level evaluator is module-internal and is not exported as a second runtime entrypoint.
