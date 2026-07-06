# Boundary Tightening

Status: tightened_offline_boundary_not_active_runtime.

## Boundary Rules

The allowed future coupling owner remains exactly:

```text
mutation_capable_tool_invocation_preflight
```

The runtime helper added in this phase evaluates explicit sanitized refs only. It does not scan the whole workspace at runtime and does not import or call active owner code beyond the existing preflight owner constant and evaluator already used by the offline scorecard.

## Denied Roots

Denied active-consumer roots include:

- TaskLoop and agents orchestration outside the existing before-tool-call preflight hook
- ACP/control-plane paths
- Gateway payloads and server methods
- provider transport
- prompt/model-message assembly
- retry, approval, rollback, and completion paths
- checkpoint and lifecycle authority state
- Electron main, services, and preload
- renderer `src/`
- scripts, services, daemons, listeners, databases, exporters, schedulers, and always-on sidecars

Any denied-root consumer remains a hard veto for continuation.

## Conclusion

Boundary status is ready for future preflight-owner-only design. It is not approval for active blocking, production/default-on behavior, or owner expansion.

