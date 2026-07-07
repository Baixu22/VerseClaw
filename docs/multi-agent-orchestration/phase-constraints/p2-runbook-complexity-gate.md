# P2 Phase Constraint: RunbookTemplate And Complexity Gate

> Active phase: P2 only.
>
> Goal: add a structured task-entry decision gate and reusable runbook templates on top of the P0/P1 orchestration foundation.

## 1. Phase Objective

P2 decides when multi-agent orchestration is worthwhile and how common complex tasks should enter a reusable structured plan. It does not make workers more powerful and does not replace the P0 verification loop or the P1 scheduler.

P2 is successful when:

- a `ComplexityGate` classifies tasks into `single-agent`, `role-routed`, `team-orchestrated`, or `runbook-orchestrated`,
- classification is explainable through structured signals and reason codes,
- simple tasks default away from multi-agent orchestration unless explicitly requested,
- high-risk, multi-file, or cross-domain tasks can select team or runbook orchestration,
- a `RunbookTemplate` schema describes intent, roles, task graph skeleton, verification policy, handoff rules, and expected evidence,
- runbook selection produces traceable selected/unselected reasons,
- runbook-generated task graphs still pass through RoleContract, ResourceAwareWaveScheduler, SchemaComplianceGate, VerifierGate, and max-one repair boundaries.

## 2. Current Baseline

P0 provides:

- `OrchestrationResultBundle`,
- `SchemaComplianceGate`,
- `VerifierGate`,
- max-one repair/replan accounting,
- permission denial and memory proposal representation in trace/bundle.

P1 provides:

- `ResourceAwareWaveScheduler`,
- runtime max-active-role enforcement,
- scheduler metrics,
- tool contention separation,
- draft-only Agency catalog import.

P2 should add an entry decision layer and runbook registry. It must not weaken existing RoleContract, scheduler, gate, trace, or memory boundaries.

## 3. Allowed Changes

P2 may:

- add a focused `ComplexityGate` module under `openclaw_runtime/src/agents/`,
- add complexity signal and decision types,
- add table-driven complexity classification tests,
- add a focused `RunbookTemplate` schema/registry module under `openclaw_runtime/src/agents/`,
- add built-in runbook fixtures for common workflows,
- add runbook validation helpers,
- add runbook-to-task-graph conversion that consumes existing RoleContract names and existing task graph types,
- integrate selection metadata into existing orchestration planning without changing worker permissions,
- add selected/unselected reason trace fields or result details,
- update harness/docs for P2.

## 4. Forbidden Changes

P2 must not:

- implement P3 typed blackboard,
- implement P4 synthesizer,
- add Role Catalog UI,
- add open worker-to-worker chat,
- let runbook prose become a runtime prompt or permission authority,
- let Agency markdown agents become runtime roles,
- bypass `RoleContract` validation,
- bypass P1 scheduler max-active-role or tool contention enforcement,
- bypass P0 schema/verifier gates,
- add new long-term memory persistence strategy,
- let workers directly write long-term memory,
- treat the number of available Agency agents as a capability signal.

## 5. Complexity Gate Boundary

`ComplexityGate` is an orchestration entry decision aid.

It may consider:

- task text length and explicit user intent,
- file hint count and file scope,
- risk keywords or configured risk hints,
- required capability diversity,
- tool needs inferred from existing role/router signals,
- prior failure or retry signals when supplied as structured input,
- explicit template/runbook selection by the user.

It must not:

- block explicit user selection of a team template,
- grant tools or permissions,
- create roles,
- modify task graph nodes after creation,
- override P0/P1 runtime enforcement,
- rely on prompt-only instructions for safety.

The gate output must include:

- mode decision,
- confidence,
- signal summary,
- selected runbook candidate when applicable,
- selected/unselected reasons,
- cost/risk warning text as data.

## 6. Runbook Boundary

`RunbookTemplate` is structured planning data, not a long prompt.

It may define:

- stable id and version,
- intent matchers,
- required roles and optional roles by role contract name,
- task graph skeleton,
- verification policy,
- handoff rules,
- expected evidence,
- route constraints,
- fixture metadata.

It must not:

- define raw runtime system prompts,
- grant runtime tools,
- grant filesystem/network/command permissions,
- add active roles outside the role registry,
- skip verifier/schema gates,
- skip scheduler enforcement,
- silently activate Agency-derived runbooks without review.

## 7. Acceptance Criteria

P2 is accepted only when all of these pass:

- ComplexityGate classification table tests cover simple, role-routed, team, and runbook decisions.
- Explicit user team selection is not blocked by ComplexityGate.
- RunbookTemplate validation rejects missing roles, missing evidence policy, duplicate node ids, and unknown skeleton dependencies.
- Built-in runbook fixtures validate successfully.
- Runbook-to-task-graph tests prove graph nodes reference existing RoleContract names only.
- Runbook-to-task-graph tests prove scheduler and verifier boundaries remain in the resulting graph.
- Selection trace tests prove selected and unselected runbook reasons are represented as structured data.
- Existing P0 and P1 tests remain green.
- Harness validation for `role-first-p2-runbook-complexity-gate` passes.

## 8. Required Non-Goal Checklist

The final report must explicitly state:

- Blackboard not implemented.
- Synthesizer not implemented.
- Role Catalog UI not implemented.
- New memory persistence strategy not implemented.
- Open worker-to-worker chat not implemented.
- Agency markdown agents not activated as runtime roles.
- Runbook prose does not grant tools or permissions.
