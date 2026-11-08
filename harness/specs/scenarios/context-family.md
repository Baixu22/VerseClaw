---
id: context-family
title: Context Family Semantic Runtime
type: context-family-boundary
ownedPaths:
  - docs/context-family/**
  - harness/specs/scenarios/context-family.md
  - harness/specs/rules/context-family-boundary.md
  - harness/specs/tasks/context-family-*.md
  - harness/specs/tasks/context-item-registry-shadow.md
  - harness/specs/tasks/context-lifecycle-event-audit.md
  - harness/specs/tasks/context-lossless-archive-mvp.md
  - harness/specs/tasks/context-status-projection-shadow.md
  - harness/specs/tasks/context-observation-masking-projection.md
  - harness/specs/tasks/context-readonly-recall-surface.md
  - harness/specs/tasks/context-inline-spill-default-path.md
  - harness/specs/tasks/inline-spill-real-benefit-eval-round3.md
  - harness/specs/tasks/inline-spill-real-benefit-closeout.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/fixtures/context-inline-spill-benefit-round3/**
  - harness/specs/fixtures/context-inline-spill-benefit-closeout-20261108/**
  - harness/specs/fixtures/context-inline-spill/**
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - workspace-harness-single-source
---

Context Family defines the shared semantic layer for context identity,
lifecycle, provenance, projection, archival, and recovery. It is the vocabulary
that lets context components talk about the same information without creating a
new owner of that information.

Use this scenario when work defines or changes:

- `ContextItem` identity, kind, source, and ownership semantics.
- Lifecycle states and lifecycle transition reasons.
- Projection modes such as verbatim, masked, summary, index-only, or omitted.
- Provenance and ArchiveHandle semantics.
- ContextItemRegistry shadow metadata.
- Context Status projections.
- Observation masking and read-only recall surfaces.
- Default truncation archive references and explicitly enabled, bounded
  retention of verified archive recall result projections.
- The staged harness task map for Context Family work.
- Model-driven Inline/Spill evaluation with projection-only protocol outputs and identical initial inputs for retention pressure pairs.
- Offline replay of sealed Inline/Spill results, with evidence-task and absent-evidence control pairs reported separately when interpreting retention benefit.
- Evaluation-only archive pages require explicit 1–5500 character sizes, with invalid requests rejected before archive access and every returned page still passing through production projection.

## Scenario Boundaries

- Context Family is the Context Runtime semantic layer. It is not a new storage
  system, task truth system, prompt builder, tool execution policy, UI state
  model, or memory system.
- Prompt is a projection, not the source of truth.
- Runtime behavior promotion requires a narrower task spec with flag-off parity,
  rollback, metrics, and tests.
- Lossless recovery claims require archive handles with checksum verification.
- Observation masking requires archive handles first and must start as
  projection-only.
- Durable policy belongs under `AGENTS.md` and `harness/specs/**`; do not create
  a parallel `.trellis/`, `.cvk/rules`, hidden context database, independent
  rule tree, or other durable source of truth.

## Relationship To Existing Owners

| Surface | Relationship |
|---|---|
| Context Runtime Kit / CVK | Provides address, selector, checksum, compact view, tool selector, and recovery projection protocols that Context Family can reference. Context Family does not replace CRK. |
| CompressionArtifact v1 | Maps to a `ledger` ContextItem and recovery carrier. It is not proof of completion and must not absorb large durable facts as unverified prose. |
| Handoff | Maps to a derived continuation projection. It remains preview-first, user-editable, deterministic, and non-mutating until the user creates the new session. |
| Fork | Maps to session lineage provenance. It creates a transcript branch through runtime but does not create Git branches, handoff prompts, Memory/Knowledge writes, or task truth. |
| Task Ledger | Owns durable user-facing task truth, dependencies, blockers, decisions, deviations, review state, and session links. Context Family may cite or project it only. |
| ClawGraph | Owns workflow execution state, DAG scheduling, worker handoffs, audit, review, and run events. Context Family may reference handoffs and evidence only. |
| Observability | Owns run evidence, traces, spans, tool events, and scorecards. Context Family may cite evidence refs but cannot decide completion from them alone. |
| Memory / Knowledge | Own governed reusable knowledge. Context Family may reference governed items and evidence, but must not write or apply knowledge automatically. |
| LoopContextPack / Context Pack | Own bounded injection recipes for loop recovery and role/task context. Context Family names them as projections, not durable truth. |
| Transcript JSONL | Owns chat replay history for sessions. It is not durable long-task truth and is not a lossless archive unless future handles prove it. |

## Stage Model

Context Family work starts with semantic documents and then moves through narrow
task specs:

- Semantic Constitution: vocabulary, axioms, scenario, boundary, progress.
- Protocol Types: additive shared types and pure validation.
- Registry Shadow: metadata-only registration and status snapshots.
- Shadow Ingestion: non-fatal registration at existing context entry points.
- Lifecycle Audit: provenance events for existing transformations.
- Lossless Archive MVP: checksum-backed handles before irreversible reduction.
- Context Status Shadow: bounded diagnostic projection with flag-off parity.
- Observation Masking Projection: projection-only masking with archive handles.
- Read-only Recall Surface: checksum-verified recovery through proper
  runtime/Main/Host boundaries.
- Policy Promotion: small reversible promotions with evidence and rollback.

Each stage must update `docs/context-family/goal-progress.md` with decisions,
files touched, tests run, unverified claims, risks, and next action.
