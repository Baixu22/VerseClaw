# P3 Phase Constraint: Typed Blackboard And Bounded A2A

> Active phase: P3 only.
>
> Goal: add a typed orchestration blackboard so roles can share bounded evidence, questions, risks, conflicts, handoffs, and memory proposals without creating open worker-to-worker chat or bypassing P0-P2 controls.

## 1. Phase Objective

P3 introduces controlled shared orchestration state. The blackboard is a typed data structure with append-only or versioned update semantics. It is not a chat room, not a prompt channel, not a permission source, and not a long-term memory store.

P3 is successful when:

- `OrchestrationBlackboard` validates typed entries for facts, claims, questions, risks, decisions, artifacts, conflicts, handoffs, and memory proposals,
- every entry records author role, task id, confidence, evidence refs, visibility, status, trust boundary, version, and timestamps,
- append and update operations preserve history instead of silently overwriting prior content,
- conflicting claims create conflict entries with references to both sides,
- untrusted worker or external content is marked as untrusted data and never promoted into system instructions,
- verifier code can consume blackboard evidence references without bypassing `SchemaComplianceGate` or `VerifierGate`,
- trace replay can reconstruct blackboard history from structured events,
- bounded A2A is represented only through blackboard entries and handoff records, not direct worker-to-worker messaging.

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

P2 provides:

- `ComplexityGate`,
- `RunbookTemplate` validation,
- built-in runbook registry,
- runbook-to-task-graph conversion,
- selected/unselected runbook reason metadata.

P3 must preserve all P0/P1/P2 boundaries. The blackboard may enrich shared evidence and handoff state, but it must not grant tools, mutate role contracts, skip the scheduler, skip gates, or become persistent memory by itself.

## 3. Allowed Changes

P3 may:

- add a focused `OrchestrationBlackboard` module under `openclaw_runtime/src/agents/`,
- add blackboard entry and operation types,
- add validation helpers for entry shape, evidence refs, visibility, status, confidence, and trust boundary,
- add append and versioned update APIs,
- add conflict detection and conflict-entry creation for incompatible claims,
- add untrusted content propagation and prompt-injection defense metadata,
- add verifier read helpers that consume blackboard evidence as structured data,
- add trace event helpers that allow blackboard replay reconstruction,
- add structured bounded handoff entries as blackboard data,
- add P3 unit/eval tests and fixture scenarios,
- update harness/docs for P3.

## 4. Forbidden Changes

P3 must not:

- implement P4 synthesizer,
- add Role Catalog UI,
- add open mesh A2A,
- add direct worker-to-worker chat,
- add new long-term memory persistence strategy,
- let blackboard entries automatically become long-term memory,
- let workers directly write long-term memory,
- let blackboard entries grant tools, permissions, filesystem, network, command, MCP, or memory write access,
- bypass `RoleContract` validation,
- bypass P1 scheduler max-active-role or tool contention enforcement,
- bypass P0 schema/verifier gates,
- bypass P2 runbook boundaries,
- activate Agency markdown agents as runtime roles,
- treat prompt text, handoff prose, or blackboard prose as a runtime permission authority.

## 5. Blackboard Entry Boundary

Blackboard entries are typed orchestration facts. Each entry must include:

- stable id,
- type,
- author role,
- task id,
- content data,
- confidence,
- evidence refs,
- visibility,
- status,
- trust boundary,
- version,
- timestamps,
- optional supersedes/conflicts-with references.

Supported entry types are:

- `fact`,
- `claim`,
- `question`,
- `risk`,
- `decision`,
- `artifact`,
- `conflict`,
- `handoff`,
- `memory_proposal`.

Entry validation must reject:

- unknown entry types,
- unknown author roles,
- missing task ids,
- invalid confidence values,
- missing evidence refs for entry types that require evidence,
- unsafe permission-like fields,
- attempts to mark untrusted content as trusted without an explicit trusted source,
- attempts to write direct memory state instead of a memory proposal.

## 6. Bounded A2A Boundary

Bounded A2A means roles coordinate through structured blackboard entries. It does not mean roles message each other freely.

P3 may support:

- handoff entries from one role/task to another,
- question entries addressed to a role or verifier,
- artifact references shared by visibility scope,
- conflict entries for incompatible claims,
- decision entries authored by an authorized coordinator/verifier path.

P3 must not support:

- direct worker-to-worker chat transport,
- arbitrary message streams between workers,
- worker mutation of another worker's entry without versioned update rules,
- hidden prompt channels derived from blackboard text,
- permission transfer through handoff text.

## 7. Trust And Prompt-Injection Boundary

Any content authored by a worker, external source, tool output, file content, or imported text is untrusted unless a structured caller marks a trusted system source. Untrusted content may be stored, summarized, cited, and verified as data. It must not be interpreted as system, developer, role, or tool instructions.

Prompt-injection defense is accepted only when:

- unsafe instruction-like text remains in entry content data,
- the entry carries a trust boundary marker,
- verifier and trace consumers can see that marker,
- no blackboard field grants or expands runtime permissions.

## 8. Acceptance Criteria

P3 is accepted only when all of these pass:

- Entry validation tests cover every supported entry type.
- Validation rejects unknown roles, invalid confidence, missing required evidence, invalid visibility/status, unsafe permission fields, and direct memory writes.
- Append tests prove entries preserve stable ids, version 1, timestamps, author role, task id, and trust boundary.
- Versioned update tests prove old versions remain reconstructable and updates cannot silently overwrite conflicts.
- Conflict detection tests prove incompatible claims create a conflict entry referencing both claims.
- Untrusted content tests prove prompt-injection text is stored as data and marked untrusted.
- Verifier evidence tests prove verifier reads blackboard evidence refs without bypassing P0 gates.
- Trace replay tests prove blackboard history can be reconstructed from append/update/conflict events.
- Existing P0/P1/P2 tests remain green.
- Harness validation for `role-first-p3-typed-blackboard` passes.

## 9. Required Non-Goal Checklist

The final report must explicitly state:

- Synthesizer not implemented.
- Role Catalog UI not implemented.
- Open mesh A2A not implemented.
- Direct worker-to-worker chat not implemented.
- New long-term memory persistence strategy not implemented.
- Worker direct long-term memory writes not implemented.
- Blackboard entries do not automatically become memory.
- Blackboard prose does not grant tools or permissions.
- Agency markdown agents not activated as runtime roles.
