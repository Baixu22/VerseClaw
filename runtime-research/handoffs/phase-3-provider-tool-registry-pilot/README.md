# Phase 3 Handoff: Provider and Tool Registry Pilot

Phase 3 starts after Phase 2 accepted the runtime-core contract and shadow-adapter foundation. The goal is to pilot registry-based provider/tool orchestration while keeping the legacy path authoritative and reversible.

## Phase Goal

Build the smallest feature-flagged pilot for:

- `RuntimeContextProviderRegistry` composition over existing context seams;
- `ToolProviderRegistry` composition over existing MCP/built-in tool seams;
- provider/tool manifests with ids, capabilities, permissions, evidence refs, and fallback reasons;
- registry shadow comparison and optional diagnostics;
- flag-off parity for legacy prompts, MCP responses, approvals, and task-loop statuses.

## Non-Negotiable Constraints

1. Do **not** start a second runtime service.
2. `verseshell-runtime` is the user-configured stdio terminal tool exception, not a Phase-3 registry service or task runtime.
3. Runtime core and registry pilot code must live under `openclaw_runtime/**` or existing Main adapters; renderer must not own transport/policy logic.
4. No new renderer direct `window.electron.ipcRenderer.invoke(...)` calls.
5. No renderer direct Gateway HTTP/WebSocket calls to `127.0.0.1:18789` / `localhost:18789`.
6. No default-on provider/tool registry cutover until flag-off and shadow parity tests pass.
7. Existing legacy behavior must remain authoritative unless a lane explicitly records a feature flag, rollback, and tests.
8. Any UI change must include/run targeted Electron E2E.

## Required Reading

Every implementation window must read:

- `runtime-research/agent-runtime-index.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/parallel-lanes.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submission-template.md`
- `harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md
```

If that command is unavailable in the shell, record the failure and use:

```powershell
rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff
```

## Output Rules

Each lane writes exactly one submission:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/<lane-id>.md
```

Lane owners may edit only their declared implementation/test paths and their own submission file. Cross-lane conflicts are recorded in `Design Conflicts` / `Handoff Notes`; the synthesis owner reconciles them.

## Expected Lanes

- `lane-a-registry-contracts-and-flags`
- `lane-b-context-provider-registry-pilot`
- `lane-c-tool-provider-registry-pilot`
- `lane-d-taskloop-registry-shadow-integration`
- `lane-e-harness-tests-boundary-docs`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not treat under-evidenced implementation claims as accepted facts.
