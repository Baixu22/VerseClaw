# Role-First P4 Synthesizer And Local Dynamic DAG Design

## Purpose

P4 turns verified multi-role orchestration state into a user-readable result and permits local DAG refinement when a run needs scoped follow-up structure. It builds on P0 result bundles, P1 scheduler boundaries, P2 runbook graphs, and P3 blackboard summaries.

## Scope

P4 includes:

- `OrchestrationSynthesizer`: deterministic read-only projection over `OrchestrationResultBundle`, artifacts, blackboard summary, verifier report, and trace refs.
- `LocalDynamicDagRefinement`: validation and graph augmentation for scoped nodes that remain inside current graph authorization.
- Existing gateway/UI projection for synthesis output.

P4 does not include new worker chat, tool access, memory persistence, verifier replacement, or Agency runtime activation.

## Architecture

The synthesizer lives in `openclaw_runtime/src/agents/orchestration-synthesizer.ts`. It accepts structured inputs and returns a structured `OrchestrationSynthesis` object. It does not call tools, spawn roles, read files, write memory, or mutate blackboard state.

The local dynamic DAG helper lives in `openclaw_runtime/src/agents/orchestration-dynamic-dag.ts`. It validates refinement proposals against the current graph, known roles, source-node capabilities, forbidden authority-like fields, and scheduler limits. It returns an updated graph, refinement metadata, scheduler metrics, and structured issues.

Existing gateway methods may include `synthesis` in result payloads. Renderer code displays it as a compact result surface. Renderer remains behind `hostApi.gateway.rpc`.

## Data Flow

```text
OrchestrationResultBundle + blackboard summary + verifier report
  -> OrchestrationSynthesizer
  -> structured synthesis result
  -> existing gateway response
  -> RolesOrchestrationPanel dual-column result view

TaskGraph + scoped refinement proposals + known RoleContracts
  -> LocalDynamicDagRefinement
  -> validated graph + scheduler result + refinement metadata
```

## Synthesizer Policy

The synthesis status is derived from bundle and verifier state:

- verifier `fail` always yields failed synthesis,
- verifier `repair_required` yields repair-required synthesis,
- bundle failures or partial status remain visible,
- successful synthesis requires bundle status `verified` or verifier `pass`.

The synthesis result includes `policy.toolAccess: "none"` and `policy.verifierAuthority: "preserved"`.

## Dynamic DAG Policy

Refinement proposals can only add nodes. They cannot mutate existing nodes. They cannot include `tools`, `permissions`, `prompt`, or `memoryWrite`. New roles must already be present in the graph or explicitly authorized. Dependencies must point to existing or newly proposed node ids. Capabilities must stay within the source node's capability set unless explicitly authorized.

The helper must run the P1 scheduler after graph augmentation and report scheduler metrics. This proves the refinement did not bypass max-active-role limits.

## UI

The Roles Orchestration panel should render a compact synthesis result after `orchestrator.run` returns synthesis. The left side shows final synthesized status/summary. The right side shows role contributions, evidence count, verifier decision, trace count, failures, and dynamic DAG metadata when available. Failures must be visible.

## Testing

P4 adds:

- synthesizer fixture tests,
- fail-preservation tests,
- dynamic DAG boundary tests,
- gateway payload tests,
- UI component/unit coverage as needed,
- Electron E2E smoke test for synthesis rendering,
- P0/P1/P2/P3 regression verification.
