# P1 Phase Constraint: Resource-Aware Scheduling And Agency Draft Catalog

> Active phase: P1 only.
>
> Goal: add deterministic resource-aware execution planning and draft-only Agency catalog ingestion on top of the P0 verification loop.

## 1. Phase Objective

P1 improves orchestration control before execution. It does not make workers more powerful; it makes the runtime better at deciding which already-authorized role tasks can run together, which should wait, and which Agency-derived ideas are only draft catalog material.

P1 is successful when:

- a `ResourceAwareWaveScheduler` produces deterministic execution waves from an existing task graph,
- max active roles are enforced by runtime scheduling, not UI or prompt text,
- tool contention prevents conflicting roles from sharing a wave,
- scheduling metrics explain queued/running/completed/skipped roles, concurrency cap, budget estimate, and role cost summary,
- an `AgencyRoleImporter` maps Agency-like source data into draft catalog entries only,
- Agency draft entries cannot be spawned as runtime roles,
- draft promotion to active remains gated by `RoleContract` validation and explicit review/activation.

## 2. Current Baseline

P0 already provides:

- structured `OrchestrationResultBundle` data,
- `SchemaComplianceGate`,
- `VerifierGate`,
- max-one repair decision accounting,
- task graph and simple execution waves in `openclaw_runtime/src/agents/orchestration-protocol.ts`,
- role contracts and validation in `openclaw_runtime/src/agents/role-contract.ts`,
- team templates in `openclaw_runtime/src/agents/team-template.ts`,
- observed orchestration runs and `team_orchestrate` integration.

P1 should evolve the scheduler boundary and draft catalog boundary. It must not replace RoleContract, task graph, P0 gates, or the existing Gateway communication owner.

## 3. Allowed Changes

P1 may:

- add a focused scheduler module under `openclaw_runtime/src/agents/`,
- add scheduler metrics types and deterministic wave fixtures,
- integrate scheduled waves into existing orchestration run planning without granting new permissions,
- add an Agency draft importer module under `openclaw_runtime/src/agents/`,
- add draft catalog entry types and validation helpers,
- add fixture tests for scheduler determinism, max active roles, tool contention, and draft-only import,
- update harness/docs for P1.

## 4. Forbidden Changes

P1 must not:

- implement P2 `ComplexityGate`,
- implement P2 `RunbookTemplate`,
- implement P3 typed blackboard,
- implement P4 synthesizer,
- add Role Catalog UI,
- activate Agency markdown agents as runtime roles,
- let Agency tool descriptions grant real tools,
- let prompt/persona bypass `RoleContract`,
- add open worker-to-worker chat,
- add new long-term memory persistence strategy,
- add renderer UI unless a separate UI phase is created.

## 5. Scheduler Boundary

`ResourceAwareWaveScheduler` is runtime planning data.

It may consider:

- `OrchestrationTaskGraph.nodes`,
- dependency edges,
- role names,
- role contract effort/risk/tool requirements/tools,
- max active roles,
- tool contention groups,
- estimated role cost.

It must not:

- change a role's `tools`,
- change a role's permissions,
- add roles not already selected by router/template,
- remove required verifier nodes,
- bypass P0 schema/verifier gates.

The scheduler output must include:

- scheduled waves,
- skipped nodes with reasons,
- concurrency cap,
- queued/running/completed/skipped counts,
- role cost summary,
- budget estimate,
- deterministic reasons for each wave decision.

## 6. Agency Draft Boundary

`AgencyRoleImporter` is draft-only.

It may map source data such as divisions, agent names, descriptions, tool hints, capabilities, and handoff text into draft catalog entries.

Draft catalog entries:

- have status `draft` by default,
- are not `RoleContract`,
- cannot be returned by active role registry lookup,
- cannot be spawned,
- may include a normalized role-contract candidate for review,
- must include validation issues when the candidate is incomplete or unsafe.

Promotion boundary:

- draft -> reviewed may be represented as data only in P1,
- reviewed -> active must require explicit review/activation and `RoleContract` validation,
- P1 must not silently add imported Agency entries to active runtime roles.

## 7. Acceptance Criteria

P1 is accepted only when all of these pass:

- Scheduler unit tests prove deterministic output for identical task graphs.
- Scheduler unit tests prove max active roles are enforced.
- Scheduler unit tests prove tool contention splits conflicting roles into separate waves.
- Scheduler metrics include queued/running/completed/skipped, concurrency cap, budget estimate, and role cost summary.
- Existing task graph dependencies remain respected.
- Agency importer fixture tests prove imported entries default to `draft`.
- Agency importer tests prove draft entries are not spawnable active roles.
- Draft promotion tests prove `RoleContract` validation is required before active use.
- Existing P0 verification-loop tests remain green.
- Harness validation for `role-first-p1-resource-aware-scheduler` passes.

## 8. Required Non-Goal Checklist

The final report must explicitly state:

- Complexity Gate not implemented.
- RunbookTemplate not implemented.
- Role Catalog UI not implemented.
- Blackboard not implemented.
- Synthesizer not implemented.
- New memory persistence strategy not implemented.
- Open worker-to-worker chat not implemented.
- Agency markdown agents not activated as runtime roles.
