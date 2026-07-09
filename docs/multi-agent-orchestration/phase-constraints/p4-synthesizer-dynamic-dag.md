# P4 Phase Constraint: Synthesizer And Local Dynamic DAG

> Active phase: P4 only.
>
> Goal: add a read-only synthesizer over verified orchestration results and a bounded local dynamic DAG refinement helper without granting tools, hiding verifier failures, bypassing P0-P3 gates, or creating new memory persistence.

## 1. Phase Objective

P4 produces user-readable orchestration output after P0-P3 have collected, scheduled, verified, and shared structured evidence. The synthesizer is a deterministic projection over structured data. It is not a worker, not a verifier, not a tool caller, and not a permission source.

P4 is successful when:

- `OrchestrationSynthesizer` consumes only `OrchestrationResultBundle`, artifact refs, blackboard summary, verifier report, and trace refs,
- verifier failures remain visible and cannot be converted into success,
- role contributions, evidence refs, artifacts, failures, verifier decision, trace ids, and blackboard summary are preserved in the synthesis result,
- the same input produces stable synthesis output,
- local dynamic DAG refinement can add scoped nodes only inside the current graph's authorized roles, capabilities, dependencies, and scheduler limits,
- UI exposes the synthesis in a dual-column result surface with final summary on the left and evidence/verifier/trace details on the right.

## 2. Current Baseline

P0 provides result bundles, schema compliance, verifier gates, and max-one repair accounting.

P1 provides resource-aware scheduling, runtime max-active-role enforcement, and scheduler metrics.

P2 provides complexity gating and runbook-to-task-graph conversion.

P3 provides typed blackboard entries, verifier evidence projection, and blackboard trace replay.

P4 must preserve all of those boundaries. It may summarize and project their data, but it must not mutate their authority.

## 3. Allowed Changes

P4 may:

- add a focused `orchestration-synthesizer` runtime module,
- add a focused `orchestration-dynamic-dag` runtime module,
- add structured synthesis and dynamic DAG result types,
- include synthesis metadata in existing `orchestrator.run` and `team_orchestrate` result details,
- add UI rendering for synthesis and evidence detail in the existing Roles Orchestration panel,
- add locale coverage for new visible strings,
- add P4 unit tests and an Electron E2E smoke test,
- update docs and harness specs for P4.

## 4. Forbidden Changes

P4 must not:

- give the synthesizer filesystem, network, command, MCP, memory-write, or tool access,
- let synthesizer output override `VerifierGate` or a verifier failure report,
- let dynamic DAG refinement add unknown roles or tools,
- let dynamic DAG refinement bypass scheduler max-active-role or tool contention policy,
- mutate `RoleContract`, role registry, runbook registry, blackboard state, trace history, or long-term memory,
- hide failures, permission denials, repair attempts, rejected verifier reports, or unresolved conflicts from UI,
- add open worker-to-worker chat or open mesh A2A,
- activate Agency markdown agents as runtime roles.

## 5. Synthesizer Boundary

The synthesizer may read:

- `OrchestrationResultBundle`,
- bundle artifact refs,
- bundle verifier report,
- bundle role outcomes,
- bundle failures and permission events,
- trace ids,
- a structured blackboard summary.

The synthesizer must output structured data only. The result must include status, summary text, role contribution rows, evidence refs, visible failures, artifacts, trace ids, verifier decision, and blackboard summary. It must also carry an explicit policy marker showing `toolAccess: "none"`.

## 6. Local Dynamic DAG Boundary

Local dynamic DAG refinement may add nodes only when:

- the source node exists in the current graph,
- the new role is already present in the current graph or explicitly authorized by the caller,
- dependencies refer to current or newly added nodes,
- requested capabilities are a subset of the source node's capabilities unless explicitly authorized,
- no `tools`, `permissions`, `prompt`, or `memoryWrite` fields appear in refinement proposals,
- the resulting schedule still respects P1 resource scheduler limits.

Each refinement must record source node id, reason, scope, and attempt.

## 7. Acceptance Criteria

P4 is accepted only when all of these pass:

- Synthesizer fixture tests prove stable output for identical inputs.
- Fail-preservation tests prove verifier failures remain visible and are not reported as success.
- Synthesizer policy tests prove no tool access is represented or granted.
- Blackboard summary tests prove conflict/question/risk/memory proposal counts are preserved as summary data only.
- Dynamic DAG boundary tests reject unknown roles, unknown dependencies, unsafe authority-like fields, and out-of-scope capabilities.
- Dynamic DAG scheduler tests prove refined graphs obey max-active-role limits.
- Gateway tests prove `orchestrator.run` returns synthesis without removing P0/P1/P2/P3 data.
- UI tests prove synthesis details render without hiding verifier/failure information.
- Existing P0/P1/P2/P3 regression suites remain green.
- Harness validation for `role-first-p4-synthesizer-dynamic-dag` passes.

## 8. Required Non-Goal Checklist

The final report must explicitly state:

- Synthesizer has no tool access.
- Synthesizer does not override verifier failure.
- Dynamic DAG does not add unauthorized roles or tools.
- Dynamic DAG does not bypass scheduler limits.
- Blackboard entries do not automatically become memory.
- Worker direct long-term memory writes are not implemented.
- Open mesh A2A and direct worker-to-worker chat are not implemented.
