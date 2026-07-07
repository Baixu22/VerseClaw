# P0 Phase Constraint: Verification Loop Hardening

> Active phase: P0 only.
>
> Goal: make role-first multi-agent results structured, gateable, auditable, and bounded to one repair/replan decision.

## 1. Phase Objective

P0 converts the current multi-agent result flow from "mostly prompt-rendered Team Result Bundle" into a runtime-owned structured result bundle with explicit gates.

P0 is successful when:

- role outcomes are collected into `OrchestrationResultBundle`,
- malformed or evidence-empty outcomes fail `SchemaComplianceGate`,
- verifier output is normalized by `VerifierGate`,
- repair/replan is capped at one automatic decision per orchestration run,
- gate decisions and repair attempts are visible in bundle or trace,
- worker memory candidates remain proposals only.

## 2. Current Baseline

Existing code already provides:

- task graph and execution waves in `openclaw_runtime/src/agents/orchestration-protocol.ts`,
- run and observed run bridges in `openclaw_runtime/src/agents/orchestrator-run.ts` and `openclaw_runtime/src/agents/orchestrator-run-observed.ts`,
- team result prompt rendering in `openclaw_runtime/src/agents/agent-steering-queue.ts`,
- `team_orchestrate` runtime tool in `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`,
- orchestration metadata in `openclaw_runtime/src/agents/subagent-registry.types.ts`,
- gateway handlers in `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`,
- existing tests in `tests/unit/role-orchestration-methods.test.ts`, `tests/unit/agent-steering-team-bundle.test.ts`, and `tests/unit/orchestration-protocol-v3.test.ts`.

P0 should evolve these surfaces. It must not create a parallel orchestration runtime.

## 3. Allowed Changes

P0 may:

- add a focused result bundle module,
- add a focused gates module,
- add structured bundle fields to existing run/tool return payloads in a backward-compatible way,
- refactor Team Result Bundle rendering to render from structured bundle data,
- add P0 unit tests and fixture tests,
- add trace attributes/events for gate decisions,
- add bounded repair summary and attempt count,
- add harness/docs updates tied to P0.

## 4. Forbidden Changes

P0 must not:

- implement `ResourceAwareWaveScheduler`,
- import Agency Agents into active runtime roles,
- create Role Catalog UI,
- create typed blackboard,
- create synthesizer,
- implement open mesh A2A,
- let prompt/persona bypass RoleContract,
- let worker output directly write long-term memory,
- add a new transport path,
- add renderer UI or i18n work unless a separate UI Goal is created,
- increase automatic repair/replan above one attempt.

## 5. Bundle Boundary

`OrchestrationResultBundle` is runtime data.

It must include at minimum:

- `orchestrationRunId`,
- `taskGraphId`,
- `attempt`,
- `leadRole`,
- `selectedRoles`,
- `roleOutcomes`,
- `artifacts`,
- `evidenceRefs`,
- `permissionEvents`,
- `failures`,
- `verifierReport`,
- `repair`,
- `memoryProposals`,
- `traceIds`,
- optional `budgetSummary`.

The bundle may be represented in spawn-phase form before worker completions arrive and completion-phase form after worker/verifier completions are leased.

## 6. Gate Boundary

`SchemaComplianceGate` owns structural acceptance.

It checks:

- required bundle ids,
- role outcome role/task/run identity,
- outcome status,
- evidence reference presence for successful worker outcomes,
- verifier report shape when present,
- memory proposal shape when present,
- repair attempt count.

`VerifierGate` owns verification decision normalization.

It returns:

- `pass` when schema passes and verifier accepts or no verifier is required,
- `fail` when schema fails, verifier rejects, workers all fail, or evidence is missing,
- `repair_required` when exactly one bounded repair is allowed and the failure is repairable.

## 7. Repair/Replan Boundary

P0 repair/replan is bounded continuation logic, not dynamic scheduling.

Rules:

- maximum automatic repair/replan attempt is one,
- repair keeps the same role/task boundary unless verifier explicitly identifies a narrower repair target,
- second failure returns final failure,
- repair/replan decision records reason, source gate, source role outcome, attempt number, and target task id,
- repair does not grant new tools,
- repair does not introduce new active roles beyond the existing contract/template boundary.

If the existing async completion architecture makes automatic repair execution unsafe in one Goal, P0 may land the bounded repair decision and attempt accounting first, but the final report must mark automatic repair execution as not active and not claim full P0 completion.

## 8. Acceptance Criteria

P0 is accepted only when all of these pass:

- Bundle type and builder have unit coverage.
- Malformed bundle or role outcome fails schema gate.
- Successful worker outcome without evidence fails schema gate.
- Permission denied spawn/outcome appears in bundle or trace.
- Memory candidates are represented as proposals and are not stored directly.
- Verifier pass/fail/repair-required decisions have unit coverage.
- max-one repair/replan cannot be bypassed by input params or prompt text.
- Team Result Bundle prompt rendering comes from structured bundle data or includes a direct structured-bundle test path.
- Existing role-first orchestration tests still pass.
- Harness validation for `role-first-p0-verification-loop` passes, or failure is unrelated and explained.

## 9. Required Non-Goal Checklist

The final report must explicitly state:

- Scheduler not implemented.
- Agency importer not implemented.
- Role Catalog UI not implemented.
- Blackboard not implemented.
- Synthesizer not implemented.
- New memory persistence strategy not implemented.
- Open worker-to-worker chat not implemented.

