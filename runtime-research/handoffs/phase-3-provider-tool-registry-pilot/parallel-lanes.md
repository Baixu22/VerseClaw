# Phase 3 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and must write its own submission under `submissions/`.

## Lane A: Registry Contracts And Flags

LANE_ID: `lane-a-registry-contracts-and-flags`

LANE_TITLE: Runtime provider/tool registry contracts, manifests, feature flags

LANE_SCOPE:

- Add minimal registry contract/types for context providers and tool providers.
- Keep canonical runtime contracts imported from `openclaw_runtime/src/runtime-core/**`.
- Define manifests, ids, capability declarations, priority/order metadata, fallback reasons, and error isolation shape.
- Add safe default flags, e.g. `runtime.providerRegistry.shadow`, `runtime.toolRegistry.shadow`, `runtime.registryPilot.enabled`.
- Do not register active providers/tools by default.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `openclaw_runtime/src/context-engine/**`
- `openclaw_runtime/src/tool-registry/**` or similarly owned runtime path
- `tests/unit/runtime-provider-tool-registry*.test.ts`
- `harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-a-registry-contracts-and-flags.md
```

## Lane B: Context Provider Registry Pilot

LANE_ID: `lane-b-context-provider-registry-pilot`

LANE_TITLE: Context provider registry over LoopContextPack and LegacyContextEngine

LANE_SCOPE:

- Wrap `LoopContextPack` and `LegacyContextEngine` as compatibility context providers.
- Preserve prompt text/message arrays with registry flags off and on in shadow mode.
- Emit provider diagnostics and `ContextItem[]` evidence/fallback metadata.
- Do not implement AgentMap ranking or provider ordering cutover yet unless behind pilot flag and parity tests.

SUGGESTED_PATHS:

- `openclaw_runtime/src/context-engine/**`
- `openclaw_runtime/src/agents/loop-context-pack.ts`
- `tests/unit/context-shadow-adapter.test.ts`
- new `tests/unit/context-provider-registry.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-b-context-provider-registry-pilot.md
```

## Lane C: Tool Provider Registry Pilot

LANE_ID: `lane-c-tool-provider-registry-pilot`

LANE_TITLE: Tool provider registry over MCP callTool compatibility provider

LANE_SCOPE:

- Wrap existing MCP `callTool` shadow adapter as the first compatibility tool provider.
- Keep `McpCallToolResult` legacy return shape unchanged.
- Add provider manifest, policy/fallback metadata, and normalized `ToolCallResult` evidence.
- Preserve permission waiting/blocked/error semantics as adapter metadata until a later policy cutover.
- Do not expose new visible MCP tools as part of this lane.

SUGGESTED_PATHS:

- `electron/services/tool-protocol-shadow.ts`
- `electron/services/mcp-api.ts`
- possible runtime-owned registry adapter path under `openclaw_runtime/**`
- `tests/unit/mcp-api.test.ts`
- new `tests/unit/tool-provider-registry.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-c-tool-provider-registry-pilot.md
```

## Lane D: TaskLoop Registry Shadow Integration

LANE_ID: `lane-d-taskloop-registry-shadow-integration`

LANE_TITLE: TaskLoop consumes registry diagnostics as shadow evidence only

LANE_SCOPE:

- Attach registry diagnostics/evidence refs to TaskLoop shadow events when flags are enabled.
- Do not change TaskLoop final status, lifecycle payloads, self-check decisions, or checkpoint authority.
- Keep `runtimeTaskEventLogShadow`, `runtimeCoreShadow`, and evidence verifier flags independent and reversible.
- Record registry fallback reason as shadow evidence, not final task failure.

SUGGESTED_PATHS:

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/agents/long-task-control/**`
- `tests/unit/task-loop-controller.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-d-taskloop-registry-shadow-integration.md
```

## Lane E: Harness, Tests, Boundary, Docs

LANE_ID: `lane-e-harness-tests-boundary-docs`

LANE_TITLE: Phase 3 validation, boundary scan, docs/index updates, synthesis readiness

LANE_SCOPE:

- Validate `phase-3-provider-tool-registry-pilot` harness spec.
- Run focused lane tests and a combined Phase-3 unit slice.
- Run boundary scans for renderer direct IPC/Gateway bypass.
- Run comms replay/compare if Main/Gateway communication paths changed.
- Run targeted E2E if any user-visible UI changes landed.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts lanes.

SUGGESTED_PATHS:

- `harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/**`
- relevant tests

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-e-harness-tests-boundary-docs.md
```
