# Role-First P2 RunbookTemplate And Complexity Gate Design

## Purpose

P2 adds a controlled entry layer for role-first orchestration. The system should avoid multi-agent overhead for simple work, escalate appropriately for complex work, and use reusable runbook templates for common workflows without bypassing P0 verification or P1 scheduling.

## Scope

P2 includes two bounded subsystems:

- `ComplexityGate`: classifies incoming work into `single-agent`, `role-routed`, `team-orchestrated`, or `runbook-orchestrated`.
- `RunbookTemplate`: structured, validated templates that produce task graph skeletons and expected evidence requirements.

P2 does not include typed blackboard, synthesizer, Role Catalog UI, open A2A, new memory persistence, or Agency markdown runtime activation.

## Architecture

The gate runs before orchestration plan execution. It consumes structured inputs such as task text, file hints, explicit user intent, risk hints, capability hints, and prior failure signals. It returns a decision with reasons; it does not mutate roles, tools, permissions, or worker prompts.

Runbook templates live as structured runtime planning data. A selected runbook maps to existing `RoleContract` names and existing task graph concepts. The resulting graph still flows through `ResourceAwareWaveScheduler`, `OrchestrationResultBundle`, `SchemaComplianceGate`, `VerifierGate`, and max-one repair handling.

## Data Flow

```text
User task + hints
  -> ComplexityGate
  -> role-routed / team-orchestrated / runbook-orchestrated decision
  -> RunbookTemplate selection when applicable
  -> existing RoleContract-backed task graph
  -> ResourceAwareWaveScheduler
  -> P0 result bundle and gates
```

## Complexity Decisions

The gate should be deterministic. Signals should be normalized into a small typed set:

- task length,
- file hint count,
- explicit user orchestration intent,
- risk indicators,
- required capability families,
- tool need hints,
- prior failure hints.

Simple tasks should default to `single-agent`. Explicit user requests can choose a team, but the gate may still attach cost/risk warnings. High-risk, multi-file, cross-domain, or repeated-failure tasks should be eligible for team or runbook orchestration.

## Runbook Semantics

A runbook template is not a prompt. It is a structured plan:

- stable id and version,
- intent matchers,
- required role names,
- optional role names,
- task graph skeleton,
- verification policy,
- handoff rules,
- expected evidence,
- selection reasons.

Runbook validation must reject unknown roles, duplicate node ids, unsatisfied dependencies, missing expected evidence, and unsafe fields that try to grant tools or permissions.

## Error Handling

Complexity classification should return conservative decisions with reasons instead of throwing for ordinary inputs. Throw only for invalid caller shape that cannot be normalized.

Runbook selection should return selected and unselected candidates with reasons. A malformed runbook should be reported as invalid data, not silently ignored when it was explicitly requested.

## Testing

P2 implementation should add:

- ComplexityGate classification table tests,
- explicit user override tests,
- RunbookTemplate validation tests,
- built-in runbook fixture tests,
- runbook-to-task-graph snapshot tests,
- selected/unselected reason trace tests,
- regression proof for P0/P1 suites.

## Review Gates

Before P2 is review-ready:

- simple tasks must not default into multi-agent orchestration,
- runbooks must be structured templates rather than long prompts,
- runbook graphs must reference existing RoleContract names only,
- scheduler and verifier boundaries must remain intact,
- no P3/P4 production features may appear,
- communication changes must pass `comms:replay` and `comms:compare` when touched.
