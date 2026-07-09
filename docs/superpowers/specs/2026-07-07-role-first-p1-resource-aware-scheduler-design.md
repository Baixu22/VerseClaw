# Role-First P1 Resource-Aware Scheduler Design

## Purpose

P1 adds a runtime-owned scheduling and draft catalog layer on top of the P0 verification loop. It should make multi-agent execution more predictable and auditable without making roles more powerful.

## Scope

P1 includes two bounded subsystems:

- `ResourceAwareWaveScheduler`: deterministic execution waves, max active role enforcement, tool contention separation, cost/budget metrics, and explainable scheduling decisions.
- `AgencyRoleImporter`: draft-only ingestion of Agency-like source material into reviewable catalog entries that are not active runtime roles.

P1 does not include Complexity Gate, RunbookTemplate, Role Catalog UI, typed blackboard, synthesizer, open A2A, or long-term memory policy changes.

## Architecture

The scheduler consumes existing `OrchestrationTaskGraph` nodes and existing `RoleContract` data. It produces scheduled waves and metrics that can replace or wrap the simple `buildExecutionWaves()` output at orchestration run time. The scheduler is not an authority for permissions: it may delay, split, or skip nodes with a reason, but it may not change role tools, filesystem/network access, or model-facing prompts.

The Agency importer consumes plain structured source data and emits `AgencyDraftRoleEntry` values. These entries are catalog/review data, not `RoleContract`. A draft may include a normalized role-contract candidate and validation issues, but it must not enter `buildRoleRegistry()` or `spawnRoleSubagent()` unless a later explicit activation flow validates and promotes it.

## Data Flow

```text
Role router / TeamTemplate
  -> OrchestrationTaskGraph
  -> ResourceAwareWaveScheduler
  -> scheduled waves + scheduler metrics
  -> existing role spawn path
  -> P0 OrchestrationResultBundle + gates
```

```text
Agency source fixtures
  -> AgencyRoleImporter
  -> draft catalog entries
  -> RoleContract validation report
  -> explicit review/activation boundary
```

## Scheduler Decisions

The scheduler should be deterministic. Sort ready nodes by dependency order, role priority, estimated cost, and stable task id. Apply max active role caps and tool contention groups after dependencies are satisfied.

Contention is based on structured role data:

- shell/write tools contend with other shell/write roles unless explicitly separated by dependency edges,
- roles with identical exclusive `toolRequirements` contend,
- verifier nodes should run after workers they verify,
- required nodes are skipped only when no valid schedule can be produced and must include a reason.

## Agency Draft Semantics

Every imported Agency entry starts as `draft`. Drafts may include:

- source division or category,
- source agent name,
- draft role name,
- display name,
- description,
- capability hints,
- tool hints,
- handoff hints,
- candidate `RoleContract`,
- validation issues.

Tool hints are descriptive only. They do not grant runtime tools.

## Error Handling

Scheduler failures should produce typed skipped-node reasons rather than throwing for ordinary conflicts. Throw only for invalid caller input such as a missing graph.

Agency importer errors should be per-entry validation issues. One malformed source item must not prevent other draft entries from being produced.

## Testing

P1 implementation should add:

- scheduler deterministic unit tests,
- max active roles tests,
- tool contention tests,
- dependency preservation tests,
- metrics shape tests,
- Agency importer fixture tests for divisions/tools/handoff text,
- draft-not-spawnable tests,
- RoleContract validation regression tests,
- existing P0 suite regression proof.

## Review Gates

Before P1 is review-ready:

- scheduler output must be deterministic,
- max active roles must be runtime-enforced,
- Agency drafts must remain inactive,
- no P2-P4 production features may appear,
- communication changes must pass `comms:replay` and `comms:compare` when touched.
