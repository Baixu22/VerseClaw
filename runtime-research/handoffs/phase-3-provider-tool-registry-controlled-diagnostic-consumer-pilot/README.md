# Registry Controlled Diagnostic Consumer Pilot

Status: accepted_controlled_pilot_ready

## Intent

This pilot is the next allowed registry slice after accepted controlled runtime-use readiness. It is limited to explicit controlled diagnostic consumption from caller-owned in-memory registry collector output.

The pilot does not require the AST pilot and does not authorize any AST behavior.

## Accepted Evidence Baseline

| Evidence | Status | Source |
|---|---|---|
| Runtime-use prerequisites | `accepted_runtime_use_prerequisites_complete` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| Controlled readiness | `accepted_controlled_runtime_use_readiness` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| Registry diagnostic collector synthesis | `Status: accepted` | `runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/synthesis.md` |
| Runtime index registry boundary | controlled diagnostics only; no provider ordering, tool authority, TaskLoop authority, or default registry cutover | `runtime-research/agent-runtime-index.md` |
| Boundary sentinel | registry exports stay diagnostics-only; collector stays default-off, bounded, and caller-owned | `tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts` |

## Pilot Scope

Allowed:

- Explicit caller-owned registry diagnostic collector output.
- In-memory or test-owned diagnostic sinks only.
- Bounded diagnostic summaries for context/tool/generic surfaces.
- Shadow metadata/evidence refs only under the accepted explicit collector and surface shadow gates.

Forbidden:

- Provider ordering cutover, default provider registration, automatic provider enablement, active provider authority, or active tool authority.
- TaskLoop decision, completion, checkpoint, lifecycle, final status, self-check, prompt, or model-message authority changes.
- Gateway payload, provider transport, MCP response shape, approval/retry/error semantic, runtime send/receive, delivery, or fallback changes.
- Renderer direct IPC or direct Gateway HTTP/WebSocket calls.
- Diagnostic persistence outside explicit in-memory/test-owned sinks.
- Services, listeners, daemons, HTTP/WebSocket servers, second Gateway/runtime, external databases, non-MCP transport, or default-on behavior.

## Feature Flags

- `runtime.registryDiagnostics.collector`: default false by omission.
- `runtime.registryPilot.enabled`: default false by omission.
- `runtime.providerRegistry.shadow`: default false by omission.
- `runtime.contextProviders.registryPilot`: default false by omission.
- `runtime.toolRegistry.shadow`: default false by omission.
- No flag in this pilot can enable provider ordering, default provider registration, active tool authority, TaskLoop authority, prompt/model-message changes, Gateway/provider transport changes, persistence, service/listener/daemon behavior, or default-on behavior.

## Rollback

Close the pilot by omitting registry collector and shadow flags, dropping injected diagnostics, and discarding in-memory consumer output. Legacy context, MCP, TaskLoop, Gateway, provider transport, and renderer/Main paths remain authoritative.

## Validation Assets

- Shared sample matrix: `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/sample-matrix.md`
- Shared scorecard: `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/scorecard.md`
- Shared veto gates: `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/veto-gates.md`
- Pilot validation plan: `runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot/validation-plan.md`
