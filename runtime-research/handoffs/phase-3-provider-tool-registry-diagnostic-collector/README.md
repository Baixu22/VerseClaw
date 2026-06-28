# Phase 3 Provider Tool Registry Diagnostic Collector

Status: planning package ready; implementation synthesis starts as `needs_revision`.

## Goal

Continue the accepted Phase 3 registry pilot with a narrower follow-up:

- collect context-provider and tool-provider registry diagnostics through a runtime-owned collector;
- normalize provider success/error/denied/waiting/cancelled/unsupported outcomes into bounded shadow diagnostics;
- feed TaskLoop only through explicit injected diagnostics and shadow metadata/evidence;
- expand tool-provider shadow coverage beyond the initial MCP `callTool` compatibility provider where an existing safe adapter seam exists.

## Non-Negotiable Constraints

1. Do not change default provider ordering or register providers by default.
2. Do not change MCP `callTool` return shape, approvals, retries, errors, or permission waiting/blocked semantics.
3. Do not change TaskLoop final status, lifecycle payload authority, self-check authority, checkpoint authority, reviewer prompts, model messages, Gateway requests, or provider transport.
4. Do not persist diagnostics except through explicit test-owned/in-memory sinks.
5. Do not add renderer direct IPC, renderer direct Gateway HTTP/WS, a second runtime service, listener, daemon, local HTTP server, WebSocket server, second Gateway, or external database.

## Required Reading

- `runtime-research/agent-runtime-index.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/parallel-lanes.md`
- `runtime-research/continue/providers.md`
- `runtime-research/continue/tool-provider.md`
- `runtime-research/continue/useful-tests.md`
- `harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md
```

## Expected Lanes

- `lane-a-collector-contracts-and-flags`
- `lane-b-context-provider-diagnostics-collector`
- `lane-c-tool-provider-diagnostics-expansion`
- `lane-d-taskloop-shadow-diagnostics-bridge`
- `lane-e-validation-comms-synthesis`

## Output Rules

Each lane writes exactly one submission under:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/<lane-id>.md
```

The synthesis owner writes `synthesis.md`, classifies every lane, and updates `agent-runtime-index.md` only after accepted evidence exists.
