---
id: context-family-semantic-constitution
title: Context Family Semantic Constitution
scenario: context-family
taskType: harness-docs
intent: Establish the shared Context Family vocabulary, axioms, boundaries, component mapping, and Goal progress ledger before runtime wiring begins.
ownedPaths:
  - docs/context-family/glossary.md
  - docs/context-family/axioms.md
  - docs/context-family/goal-progress.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/rules/context-family-boundary.md
  - harness/specs/tasks/context-family-semantic-constitution.md
touchedAreas:
  - docs/context-family/**
  - harness/specs/scenarios/context-family.md
  - harness/specs/rules/context-family-boundary.md
  - harness/specs/tasks/context-family-semantic-constitution.md
expectedUserBehavior:
  - Future Goal sessions can start from Context Family docs instead of relying on long chat history.
  - Context Runtime work uses one vocabulary for item identity, kind, lifecycle, projection, provenance, archive, and recovery.
  - Existing runtime components keep their ownership boundaries while gaining a shared semantic map.
  - End users see no runtime, prompt, tool, renderer, storage, or recovery behavior change from this phase.
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - workspace-harness-single-source
forbiddenPatterns:
  - Runtime behavior changes
  - shared protocol type implementation
  - ContextItemRegistry implementation
  - archive storage implementation
  - observation masking implementation
  - recall tool or Host API implementation
  - Context Status prompt injection
  - prompt assembly changes
  - Gateway handler changes
  - Host API contract changes
  - renderer or UI changes
  - tool execution or approval changes
  - compaction algorithm changes
  - CompressionArtifact schema or serialization changes
  - database or storage schema changes
  - parallel durable source of truth
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-family-semantic-constitution.md
  - pnpm harness validate --spec harness/specs/tasks/context-family-semantic-constitution.md
  - git diff --check -- docs/context-family harness/specs/scenarios/context-family.md harness/specs/rules/context-family-boundary.md harness/specs/tasks/context-family-semantic-constitution.md
acceptance:
  - `docs/context-family/glossary.md` defines ContextItem, ContextItemKind, LifecycleState, Projection, Provenance, ArchiveHandle, ItemStore, Ingestion Gate, Projection Engine, and Context Status.
  - `docs/context-family/glossary.md` gives old-to-new terminology mappings including tool result to observation, bootstrap/system prompt to instruction, assistant output to reasoning, user message to user_intent, compaction summary to derived, and CompressionArtifact to ledger.
  - `docs/context-family/glossary.md` forbids vague language such as deleted, compressed, or truncated when lifecycle, projection, and provenance language is required.
  - `docs/context-family/axioms.md` states the existence, addressability, lifecycle, provenance, and projection axioms.
  - `docs/context-family/axioms.md` says prompt is only a projection, not truth.
  - `docs/context-family/axioms.md` says truncation, compaction, masking, omission, archive, handoff, fork, and recovery projection must leave provenance.
  - `docs/context-family/axioms.md` says ArchiveHandle is the precondition for future lossless recovery.
  - `docs/context-family/goal-progress.md` records the objective, materials read, decisions, forbidden scope, produced files, verification commands, unverified statements, next-stage recommendation, and a handoff packet template with objective, done, inProgress, blocked, decisions, filesTouched, testsRun, risks, and nextAction.
  - `harness/specs/scenarios/context-family.md` defines Context Family as the Context Runtime semantic layer, not a storage system or task truth system.
  - `harness/specs/scenarios/context-family.md` explains the relationship to Context Runtime Kit, CompressionArtifact, handoff, fork, Task Ledger, ClawGraph, Observability, Memory, and Knowledge.
  - `harness/specs/rules/context-family-boundary.md` includes shadow-first, flag-off parity, no renderer direct transcript reads, no renderer direct Gateway calls, no prompt behavior change without promotion spec, no active tool-call blocking, and no lossless-archive claims before ArchiveHandle exists.
  - Existing components are mapped to Context Family roles without claiming production closure for recoveryContext, CompressionArtifact, lossless archive, observation masking, or recall where code evidence is missing.
  - Current gaps are explicitly named for later task specs instead of implemented in this phase.
  - No runtime behavior, prompt assembly, Host API, renderer, Gateway, tool execution, approval, compaction algorithm, CompressionArtifact schema, or storage changes are made.
docs:
  required: true
  files:
    - docs/context-family/glossary.md
    - docs/context-family/axioms.md
    - docs/context-family/goal-progress.md
    - docs/context-family/goal-runbook.md
    - docs/context-family/task-slices.md
    - docs/context-family/goal-prompts.md
---

# Context Family Semantic Constitution

This task is the first Context Family Goal. It creates the constitution and
dispatch surface only. Runtime work starts in later specs.

## Scope

The phase defines the shared language for Context Runtime work:

- ContextItem identity and kind semantics.
- Lifecycle states.
- Projection modes.
- Provenance.
- ArchiveHandle preconditions.
- Existing component role mapping.
- Hard boundaries for later implementation stages.

## Non-Goals

- Do not implement shared protocol types.
- Do not implement a Registry, Archive, Masking, Recall, or Context Status
  runtime path.
- Do not alter prompt assembly or prompt text.
- Do not alter Gateway, Host API, renderer, storage, tool execution, approvals,
  retries, compaction algorithms, or `CompressionArtifact` schema.
- Do not add a parallel durable source of truth.

## Validation

Run the required harness context, harness validate, and whitespace diff checks
from the frontmatter. This task has no unit, comms, E2E, or typecheck
requirement because it is semantic/harness documentation only.

## Next Stage

After this task validates, the next Goal should be
`context-family-protocol-types`.
