# Context Family Glossary

This glossary is the shared language for Context Family work. It is normative for new Context Family specs and docs.

## ContextItem

The basic semantic unit of managed context. Any information that enters the agent's working environment can be represented as a ContextItem.

Examples:

- a bootstrap rule file;
- a user message;
- an assistant message;
- a tool result;
- a compaction summary;
- a recovery artifact;
- a selector-backed context view.

Old terms map to Context Family language as follows:

| Old term | Context Family term |
|---|---|
| tool result | `observation` ContextItem |
| bootstrap file / system prompt content / skill instruction | `instruction` ContextItem |
| user message / steer / follow-up | `user_intent` ContextItem |
| assistant response | `reasoning` ContextItem |
| compaction summary | `derived` ContextItem |
| CompressionArtifact | `ledger` ContextItem |
| prompt message list | current Projection |

## ContextItemKind

The source-governance category of a ContextItem.

- `instruction`: durable guidance from setup files, system prompt inputs, project rules, or skills.
- `observation`: tool outputs, command results, file-read results, and other external observations.
- `reasoning`: assistant-authored response content and intermediate dynamic reasoning surfaces that are persisted as conversation output.
- `user_intent`: user messages, steering messages, queued follow-ups, and explicit intervention text.
- `ledger`: structured recovery or task-state carrier such as CompressionArtifact or bounded checkpoint projections.
- `derived`: a transformed item such as a compaction summary or recovery projection derived from other items.

## LifecycleState

The current existence form of a ContextItem.

- `ingested`: accepted into the Context Family vocabulary.
- `active`: eligible for prompt projection in its current form.
- `masked`: represented by a placeholder in a prompt projection while original content remains recallable.
- `archived`: original content or source range has a checksum-backed ArchiveHandle.
- `compacted`: represented by one or more derived items.
- `evicted`: omitted from current prompt projections while metadata may remain.

Avoid vague language:

- Do not say "deleted" when the state is `evicted`.
- Do not say "compressed" without naming the derived item and provenance.
- Do not say "truncated" without recording whether original content has an ArchiveHandle.
- Do not treat `compacted` as lossless unless archive handles verify the source content.

## Projection

The current prompt-facing rendering of one or more ContextItems. Projection is not truth; it is the view selected for a model call.

Projection modes:

- `verbatim`: original text appears in the prompt.
- `masked`: a placeholder appears and points to recall metadata.
- `summary`: derived text appears.
- `index_only`: a navigation entry appears, usually with selectors.
- `omitted`: the item does not appear in the prompt.

## Provenance

The chain that explains how a ContextItem was created or transformed. Every truncation, compaction, masking, archive, recovery, or projection-sensitive rewrite must leave provenance metadata.

Provenance answers:

- What source produced this item?
- Which item or source range did it derive from?
- Which transition happened?
- Why did it happen?
- Which code path or policy triggered it?

## ArchiveHandle

A durable pointer to original content or a source range, backed by checksum verification.

ArchiveHandle is required before production observation masking can claim recallability. A checkpoint id is not automatically an ArchiveHandle.

## ItemStore

The owner of original content. Context Family does not create a new truth store by default.

Current owners include:

- transcript JSONL for conversation entries;
- existing session state and compaction checkpoint stores;
- approved archive storage after the lossless archive MVP;
- Task Ledger, ClawGraph, Observability, Memory, and Knowledge for their existing domains.

## Ingestion Gate

The boundary where raw information becomes Context Family metadata. The gate registers a ContextItem or records why registration was skipped.

## Projection Engine

The context assembly role that turns active ContextItems and their ProjectionSpec values into prompt-facing text. Existing Context Engine assembly is the closest implementation surface.

## Context Status

A bounded proprioception panel that tells the agent about context pressure, lifecycle counts, masking, compaction, archive availability, and recovery warnings. Context Status is diagnostic state, not task truth.

## Component Role Mapping

Context Family gives existing components shared names. It does not replace their
owners.

| Existing component | Context Family role | Boundary |
|---|---|---|
| Session transcript / SessionManager | ItemStore for conversation records | Useful for chat replay; not long-term task truth or a lossless archive by itself. |
| Tool result truncation | Observation lifecycle transformer | Reduces observation projection size; cannot claim recallability without ArchiveHandle provenance. |
| Preemptive overflow routing | Lifecycle decision surface | Chooses fit, truncation, compaction, and future masking policy; does not own truth. |
| Runtime compaction | Derived item producer | Produces summaries and artifacts; does not prove completion or replace Task Ledger. |
| Compaction checkpoint | Recovery index | Records summary and pre/post identity; not a raw archive handle unless future work extends it. |
| Context Runtime Kit / CVK | Address and projection protocol | Provides resources, selectors, checksums, compact views, diagnostics, and recovery projections. |
| CompressionArtifact v1 | Ledger ContextItem | Carries dynamic recovery state and evidence refs; not proof of task completion. |
| ResumeCheckpoint | Ledger ContextItem | Minimal continuation contract after pressure, interruption, review, or session rotation. |
| Handoff | Derived continuation projection | Preview-first and editable; does not auto-send or mutate Memory/Knowledge. |
| Fork | Session lineage provenance | Creates a runtime transcript branch; does not create Git branches, handoff prompts, or task truth. |
| Task Ledger | External owner of durable task truth | Context Family may cite or project it, not replace it. |
| ClawGraph | External owner of workflow execution state | Context Family may reference handoffs and evidence, not schedule nodes. |
| Observability | External owner of run evidence | Context Family may cite traces, not decide completion from them alone. |
| Memory / Knowledge | External owners of governed reusable knowledge | Context Family may reference governed items, not write them automatically. |
| LoopContextPack / Context Pack | Bounded projection recipes | Context Family names their projection role but does not make them durable truth. |

## Current Gaps

Slice 0 records these gaps for later specs instead of implementing them:

- Shared ContextItem protocol types are not implemented yet.
- A metadata-only ContextItemRegistry is not implemented yet.
- Current compaction checkpoints are recovery indexes, not proven lossless
  archives.
- Observation masking is not a production route and must wait for archive
  handles.
- Context Status is not yet a stable model-visible prompt projection.
- Read-only recall is not implemented yet.
- CompressionArtifact is a recovery carrier, not proof of completion or a
  replacement for Task Ledger, ClawGraph, or Observability.
