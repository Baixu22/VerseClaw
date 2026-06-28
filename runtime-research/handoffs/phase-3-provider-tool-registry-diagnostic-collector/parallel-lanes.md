# Phase 3 Parallel Lanes: Provider Tool Registry Diagnostic Collector

All lanes may run in separate windows. Each lane must preserve accepted Phase 3 boundaries and keep legacy behavior authoritative.

## Lane A: Collector Contracts And Flags

LANE_ID: `lane-a-collector-contracts-and-flags`

LANE_TITLE: Runtime registry diagnostic collector contract and default-off flags

LANE_SCOPE:

- Define a bounded diagnostic collector input/output shape.
- Merge context-provider and tool-provider diagnostics without changing their source contracts.
- Add `runtime.registryDiagnostics.collector` as a default-off flag or equivalent explicit option.
- Keep diagnostics in memory/caller-owned data only.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `tests/unit/runtime-provider-tool-registry*.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-a-collector-contracts-and-flags.md
```

## Lane B: Context Provider Diagnostics Collector

LANE_ID: `lane-b-context-provider-diagnostics-collector`

LANE_TITLE: Collect context provider registry diagnostics without provider ordering cutover

LANE_SCOPE:

- Gather diagnostics from `createContextProviderRegistryPilot()` / `runContextProviderRegistryPilot()` or their accepted safe seams.
- Preserve prompt/message parity and default provider ordering.
- Cover unknown provider, provider exception, disabled flags, and bounded diagnostic output.

SUGGESTED_PATHS:

- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `tests/unit/context-provider-registry.test.ts`
- `tests/unit/runtime-provider-tool-registry*.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-b-context-provider-diagnostics-collector.md
```

## Lane C: Tool Provider Diagnostics Expansion

LANE_ID: `lane-c-tool-provider-diagnostics-expansion`

LANE_TITLE: Broader tool provider shadow diagnostics beyond the initial MCP path

LANE_SCOPE:

- Extend diagnostics for unsupported MCP content, thrown provider exceptions, denied/waiting/cancelled outcomes, and normalized error categories.
- Add one non-MCP built-in tool diagnostic shape only if an existing safe adapter seam is available.
- Preserve legacy tool response shape and approval semantics.
- Do not expose new visible tools or change tool authority.

SUGGESTED_PATHS:

- `electron/services/tool-provider-registry.ts`
- `electron/services/mcp-api.ts`
- `tests/unit/tool-provider-registry.test.ts`
- `tests/unit/mcp-api.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-c-tool-provider-diagnostics-expansion.md
```

## Lane D: TaskLoop Shadow Diagnostics Bridge

LANE_ID: `lane-d-taskloop-shadow-diagnostics-bridge`

LANE_TITLE: Inject collected registry diagnostics into TaskLoop shadow metadata only

LANE_SCOPE:

- Feed collected diagnostics into `TaskLoopControllerDeps.runtimeRegistryDiagnostics` or a successor seam.
- Emit only shadow metadata/evidence refs when the accepted TaskLoop shadow gates are enabled.
- Prove final status, self-check, lifecycle payload authority, checkpoint authority, reviewer prompts, and model/Gateway/provider payloads are unchanged.

SUGGESTED_PATHS:

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `tests/unit/task-loop-controller.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-d-taskloop-shadow-diagnostics-bridge.md
```

## Lane E: Validation Comms Synthesis

LANE_ID: `lane-e-validation-comms-synthesis`

LANE_TITLE: Harness, focused tests, comms, boundary scans, docs, and synthesis readiness

LANE_SCOPE:

- Validate the task spec.
- Run focused registry collector tests, typecheck, and boundary scans.
- Run comms replay/compare if Electron Main/Gateway service paths changed.
- Update `agent-runtime-index.md` only after synthesis accepts A-D.

SUGGESTED_PATHS:

- `harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/**`
- `runtime-research/agent-runtime-index.md`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-e-validation-comms-synthesis.md
```
