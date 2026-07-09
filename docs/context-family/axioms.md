# Context Family Axioms

These axioms are the semantic constitution for Context Family work. They apply
to future Context Runtime, registry, archive, projection, masking, recall, and
handoff work unless a later harness task explicitly narrows or promotes the
behavior.

## Axiom 1: Existence

Every information unit that enters context-relevant execution exists as a
ContextItem in the semantic model.

This does not mean Slice 0 creates runtime item records. It means future work
must stop treating context as anonymous text. User intent, instructions,
observations, reasoning, ledgers, and derived artifacts must be nameable before
they can be safely transformed or recovered.

Implications:

- Tool results are observations.
- Bootstrap and system prompt material are instructions.
- Assistant output is reasoning.
- User messages are user_intent.
- Compaction summaries are derived items.
- CompressionArtifact and ResumeCheckpoint records are ledger items.

## Axiom 2: Addressability

Every ContextItem that may be transformed, cited, masked, compacted, archived,
or recovered must have a stable address.

The address may be a future ContextItem id, a transcript entry reference, a CVK
`resource_id + selector + checksum`, a Task Ledger id, a ClawGraph handoff id, an
observability trace id, or an ArchiveHandle. The address must be stable enough
for a later agent, verifier, or recovery path to find the same source.

Implications:

- Summary text is not an address.
- A compact view is navigation, not evidence.
- Hard claims need resolvable evidence references, not just prose.
- Fork and handoff lineage are provenance metadata, not task ownership.

## Axiom 3: Lifecycle

Every ContextItem has a lifecycle state, and transformations must be described
as lifecycle and projection changes.

Initial lifecycle vocabulary:

- `ingested`
- `active`
- `masked`
- `compacted`
- `archived`
- `evicted`

Lifecycle state is not the same thing as prompt visibility. An archived item may
be omitted from the current prompt yet still recoverable. A compacted item may
have a derived projection visible while the source remains in an owner store.

Implications:

- "Deleted", "compressed", and "truncated" are not sufficient descriptions.
- Projection-only masking must not claim transcript mutation.
- Runtime compaction produces derived state; it does not complete tasks by
  itself.
- A checkpoint is a recovery index unless it carries archive handles for the
  original payloads.

## Axiom 4: Provenance

Any truncation, compaction, masking, omission, archive, handoff, fork, recovery
projection, or status projection must leave provenance.

Provenance must say what changed, why it changed, who or what triggered it, and
which source items or owner-store records support it. Provenance may point to
transcript entries, archive handles, CVK selectors and checksums, Task Ledger
events, ClawGraph handoffs, observability traces, Memory/Knowledge evidence, or
runtime checkpoint records.

Implications:

- No silent rewrite is allowed in Context Family-governed work.
- Masking without archive provenance is information loss, not recoverable
  projection.
- Derived summaries must identify their source items or evidence refs when
  future phases add that capability.
- Unverified claims must remain visible as unverified rather than upgraded to
  truth.

## Axiom 5: Projection

Prompt is a projection of selected context, not the truth.

The same ContextItem may appear as verbatim text, a masked placeholder, a
summary, an index entry, or not at all. These are projection choices made under
budget, safety, relevance, and recovery constraints. The durable truth remains
with the owner store: transcript, Task Ledger, ClawGraph, Observability, Memory,
Knowledge, runtime checkpoint storage, or future archive storage.

Implications:

- Prompt assembly must not become a second source of truth.
- Context Status is a bounded diagnostic projection, not task truth.
- Handoff drafts are reviewable continuation projections, not automatic model
  truth.
- CVK compact views are navigation-only until selectors are resolved and
  checksums verify.

## Archive Handle Principle

An ArchiveHandle is the precondition for future lossless recovery.

Context Family may discuss future lossless recovery only when an original
payload or source range has a durable handle, checksum verification, and cleanup
semantics. Without that handle, recovery is best-effort continuation from
derived or owner-provided state.

Current consequence for Slice 0:

- Do not claim current compaction checkpoints are lossless archives.
- Do not claim observation masking is safe before archive handles exist.
- Do not claim CompressionArtifact alone can restore original payloads.
- Record these gaps in specs and goal progress rather than implementing them in
  the semantic constitution phase.

## Ownership Principle

Context Family unifies language; it does not seize ownership.

Existing authority remains:

- Task Ledger owns durable task truth.
- ClawGraph owns workflow execution truth.
- Observability owns run evidence.
- Memory and Knowledge own governed reusable knowledge.
- CompressionArtifact v1 owns structured recovery state, not proof of
  completion.
- LoopContextPack and Context Pack own bounded prompt injection recipes, not
  durable truth.
- Transcript JSONL owns chat replay history, not long-term task truth.

Context Family can index, cite, project, and later recover through these owners.
It must not replace them.
