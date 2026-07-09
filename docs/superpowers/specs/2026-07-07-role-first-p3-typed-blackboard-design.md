# Role-First P3 Typed Blackboard And Bounded A2A Design

## Purpose

P3 adds a controlled shared data layer for role-first orchestration. Multiple roles need a place to publish intermediate facts, claims, questions, risks, artifacts, handoffs, conflicts, and memory proposals. That place must be typed, auditable, and safe; it must not become open chat, hidden prompt state, or long-term memory.

## Scope

P3 includes one bounded subsystem:

- `OrchestrationBlackboard`: a typed blackboard with validation, append/versioned update operations, conflict detection, trust-boundary metadata, verifier read helpers, and trace replay reconstruction.

P3 does not include synthesizer, Role Catalog UI, open mesh A2A, direct worker-to-worker chat, new memory persistence, worker direct memory writes, or Agency markdown runtime activation.

## Architecture

The blackboard lives inside the orchestration runtime as structured state. Workers and orchestration code may append scoped entries through an authorized API. Updates create new versions or structured supersession links; they do not silently overwrite prior entries. Conflict detection watches claim-like entries and creates a conflict entry when two claims about the same subject are incompatible.

The blackboard is downstream of RoleContract and task graph planning. It enriches evidence and handoff state, but it does not create roles, grant permissions, schedule workers, verify results by itself, or persist long-term memory. Verifier code may read blackboard evidence as structured inputs while `SchemaComplianceGate` and `VerifierGate` remain authoritative.

## Data Flow

```text
RoleContract-backed task graph
  -> ResourceAwareWaveScheduler
  -> isolated role workers
  -> structured worker outcomes and evidence refs
  -> OrchestrationBlackboard append/update/conflict events
  -> OrchestrationResultBundle + SchemaComplianceGate
  -> VerifierGate reads bundle plus blackboard evidence refs
  -> trace replay can reconstruct blackboard history
```

## Entry Model

Each `BlackboardEntry` should include:

- `id`,
- `type`,
- `authorRole`,
- `taskId`,
- `content`,
- `confidence`,
- `evidenceRefs`,
- `visibility`,
- `status`,
- `trustBoundary`,
- `version`,
- `createdAt`,
- `updatedAt`,
- optional `supersedes`,
- optional `conflictsWith`.

Supported entry types are `fact`, `claim`, `question`, `risk`, `decision`, `artifact`, `conflict`, `handoff`, and `memory_proposal`.

Visibility should stay scoped and explicit, for example `run`, `role`, `verifier`, or `public-result`. Status should be explicit, for example `open`, `resolved`, `superseded`, `rejected`, or `needs_review`.

## Trust Boundary

Worker output, tool output, file content, imported text, and external content are untrusted by default. The blackboard may store untrusted content and make it visible to verifier logic as data, but it must not treat that content as system, developer, role, or tool instructions.

Prompt-injection defense is represented with structured metadata, not string filtering alone. Tests should prove instruction-like content remains data and does not grant tools, permissions, or memory writes.

## Bounded A2A

Bounded A2A is blackboard-mediated coordination:

- a role can publish a question entry,
- a role can publish a handoff entry,
- a role can reference evidence or artifacts,
- the system can create conflict entries,
- a verifier can cite blackboard evidence.

P3 explicitly excludes direct worker-to-worker message streams. There is no open chat channel between workers.

## Conflict Semantics

Conflicts are explicit entries. When two claim entries address the same subject with incompatible normalized conclusions, the system creates a `conflict` entry referencing both claims. Neither claim is deleted or overwritten. Resolution is a later update or decision entry that references the conflict; P3 should not hide unresolved conflicts.

## Memory Boundary

`memory_proposal` entries are proposals only. They may be included in the result bundle or passed to existing memory governance later, but blackboard append/update operations must not write long-term memory. A blackboard entry does not become memory automatically.

## Error Handling

Validation should return structured issues for ordinary invalid entries. Append/update APIs may throw only for programmer errors that make the operation impossible, such as missing blackboard storage or malformed call shape. Conflict detection should be deterministic and conservative: when unsure, keep both claims and attach a warning rather than destroying data.

## Testing

P3 implementation should add:

- typed entry validation tests for all supported entry types,
- append and versioned update tests,
- conflict detection tests,
- untrusted content propagation tests,
- verifier evidence read tests,
- trace replay reconstruction tests,
- regression proof for P0/P1/P2 suites.

## Review Gates

Before P3 is review-ready:

- no blackboard field may grant runtime permissions,
- conflicts must be preserved rather than silently overwritten,
- untrusted content must remain data,
- verifier evidence reads must preserve P0 gates,
- scheduler boundaries must remain intact,
- runbook boundaries must remain intact,
- no P4 synthesizer or UI feature may appear.
