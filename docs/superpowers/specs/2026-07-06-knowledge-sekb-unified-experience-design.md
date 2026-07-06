# Knowledge And SEKB Unified Experience Design

Status: Draft for user review
Date: 2026-07-06
Scope: Product and architecture design only. This document does not authorize
renderer, Main, runtime, schema, or API implementation by itself.

## Summary

Knowledge remains the user-facing knowledge system. SEKB is not a separate
knowledge product; it is the runtime learning layer that makes Knowledge less
manual, less rigid, and more able to absorb useful experience from real agent
runs.

The product should present one Knowledge experience with multiple sources:

- Library: source-backed wiki, imported files, OKF bundles, and user-authored
  durable knowledge.
- Memory: durable user or workspace memory already exposed through existing
  knowledge scope controls.
- Runtime Lessons: SEKB trajectories, error signatures, confirmed principles,
  and distillation suggestions generated from agent execution.

The missing layer is a lightweight Knowledge Retrieval Controller. It should
decide which sources are eligible for a given chat or agent run, how much
context each source may contribute, and whether the result is merely suggested
or automatically attached as visible context. This should be RAG-like in the
useful sense of controlled retrieval and attribution, without adding a heavy
external vector database or hiding behavior from the user.

## Problem

The existing Knowledge experience is powerful but too manual for runtime
learning:

- The user must often summarize lessons, create drafts, promote inbox items,
  and decide when to invoke knowledge.
- The Chat composer exposes knowledge controls and attachment flows in a way
  that can feel like a small knowledge-management surface inside the prompt
  box.
- Runtime lessons, troubleshooting patterns, commands, and procedures are
  mixed with source-backed wiki concepts even though they are produced by
  different evidence.
- Current retrieval controls already support scope and invocation mode, but
  they do not yet model Runtime Lessons as a first-class Knowledge source.

SEKB was created to optimize this system, not to replace it. Its value is that
agent runs can produce structured trajectories, recurring error signatures,
and candidate principles without requiring the user to write every lesson from
scratch.

## Product Principles

1. Knowledge is the product surface.
   SEKB should appear as a Knowledge source and learning engine, not as a
   competing page or separate mental model.

2. Runtime learning is automatic, durable writes are explicit.
   Trajectories and error observations may be captured automatically when SEKB
   is explicitly enabled. Confirmed principles, wiki writes, merges, archives,
   and deletes require explicit user confirmation.

3. Retrieval is controlled, visible, and bounded.
   The user should understand whether a response used Library, Memory, Runtime
   Lessons, or temporary attachments. Advice injected into an agent run must be
   visible context, not hidden correction.

4. Chat is for use and reference, not knowledge administration.
   The prompt box may attach temporary files, cite existing knowledge, or
   select retrieval policy. Durable import, review, and governance should live
   in Knowledge.

5. Keep the first version lightweight.
   Use the existing wiki search, existing memory access, SEKB lexical fallback,
   and OpenClaw SQLite-backed state. Do not add an external vector database,
   autonomous curator, hidden retry system, or verifier loop in this slice.

## Current State

Existing Knowledge desktop surface:

- Route: `src/pages/Knowledge/index.tsx`
- Tabs: Library, Inbox, Draft Inbox, Review, Governance
- Backend owner: `electron/services/knowledge-api.ts`
- Chat access: read-only search/get and route context through
  `hostApi.knowledge`
- Existing composer controls: knowledge scope, invocation mode, manual search,
  selected references, suggestions, and slash commands

Existing SEKB runtime surface:

- Runtime modules: `openclaw_runtime/src/knowledge/sekb/`
- Captures L3 trajectories, L2 confirmed principles, L1 bounded index,
  error-signature cache entries, and distillation rejection records
- Integrates through explicit runtime hooks and remains default-off
- Provides `buildSekbOperatorReport(store)` as a read-only operator snapshot
- Does not pause tools, retry work, block tool calls, rewrite outputs, or write
  principles without explicit confirmation

## Proposed Information Architecture

The Knowledge page should evolve from a manual governance workbench into a
unified knowledge control center:

- Library
  Source-backed wiki pages, imported files, OKF content, source notes,
  decisions, architecture, commands, procedures, and glossaries.

- Runtime Lessons
  SEKB operator report, captured trajectories, repeated error signatures,
  undistilled runs, active principles, and distillation suggestions.

- Review Queue
  A unified review surface for Knowledge drafts, Knowledge inbox candidates,
  SEKB distillation suggestions, and optional exports from Runtime Lessons to
  Library drafts.

- Governance
  Health checks, lint, compile, stale pages, contradictions, dangling pages,
  provenance, permission boundaries, and audit visibility.

- Retrieval Policy
  A compact control surface for source eligibility and invocation behavior:
  Off, Library, Library plus Runtime Lessons, and Advanced source selection.

This does not require deleting existing tabs immediately. The first UI slice
can add Runtime Lessons and leave the current Library, Inbox, Drafts, Review,
and Governance tabs intact. Later cleanup can merge Inbox and Drafts into
Review Queue once the new flow is proven.

## Knowledge Retrieval Controller

The Retrieval Controller is the product-level policy layer over existing
search systems. It should answer four questions for each chat message or agent
run:

1. Which sources are eligible?
   Library, Memory, Runtime Lessons, selected references, and temporary
   attachments are separate source classes.

2. What invocation mode applies?
   Manual means only selected references are used. Suggest means candidates are
   shown to the user. Auto-read means bounded visible context can be attached
   when the route decision is confident.

3. How much context can each source contribute?
   Each source receives a small budget. Runtime Lessons should prefer high
   relevance, recent matching task type, matching error signature, and active
   confirmed principles over raw trajectory detail.

4. How is provenance shown?
   UI and transcripts should distinguish source-backed Library citations from
   Runtime Lesson advice and temporary attachments.

The first implementation should be lightweight:

- Keep existing `knowledgeScope` and `knowledgeMode` semantics where possible.
- Add Runtime Lessons as an eligible source behind an explicit policy choice.
- Use existing wiki search for Library.
- Use existing memory search for Memory.
- Use SEKB retrieval and lexical fallback for Runtime Lessons.
- Return structured citations/source labels through Host API before renderer
  consumption.

## Chat Composer Direction

The prompt box should be narrowed to three responsibilities:

- Select retrieval policy for this message or session.
- Attach temporary files for this message only.
- Attach or cite existing knowledge references.

The prompt box should stop feeling like the main durable knowledge ingestion
surface. Durable upload/import should move to Knowledge, where the app can
collect provenance, classify the content, run validation, and route it through
review.

Recommended composer labels:

- Off
- Use Library
- Use Library + Lessons
- Attach temporary file
- Cite existing knowledge

Avoid putting permanent "upload to Knowledge" semantics directly in the prompt
box. When the user attaches a file in chat, the default meaning should be
temporary context. A secondary action may send the file to Knowledge import,
but that action should open or route through the Knowledge review flow.

## SEKB As The Learning Layer

SEKB should improve Knowledge through an explicit learning loop:

1. Capture
   Runtime hooks record task start, bounded task advice, tool calls,
   tool results, failures, aborts, and final outcomes as trajectories.

2. Summarize
   Operator reports expose undistilled trajectories, repeated error
   signatures, active principles, and the current L1 index preview.

3. Suggest
   Distillation proposes candidate principles from trajectories. Suggestions
   are visible and reviewable.

4. Confirm
   The user confirms a suggestion as a Runtime Lesson principle or rejects it
   with a reason. Confirming a principle uses the existing explicit
   `DistillationTool.confirm_and_save` path.

5. Reuse
   Confirmed principles participate in future retrieval and runtime advice as
   bounded visible context.

6. Export when useful
   Some Runtime Lessons should stay operational. Others may be exported to a
   Library draft when they are general documentation, commands, or runbooks.
   Exporting creates a reviewed Knowledge draft; it does not directly apply a
   wiki write.

## Manual Management

Manual management remains important, but it should shift from authoring every
lesson to reviewing and curating generated candidates:

- Users can inspect trajectories and error signatures.
- Users can confirm or reject SEKB suggestions.
- Users can archive or demote confirmed Runtime Lessons through explicit
  actions.
- Users can convert a Runtime Lesson into a Knowledge draft when it should
  become source-backed documentation.
- Users can still write Library drafts manually for decisions, architecture,
  procedures, or source notes.

This keeps human authority while reducing manual summarization work.

## What To Keep

Keep these Knowledge capabilities:

- Library search and page preview
- Import files, folders, and OKF bundles
- Source-backed wiki compilation and linting
- Governance health checks
- Review and apply confirmation boundaries
- Manual Library drafts
- Chat read-only knowledge references
- Explicit knowledge scope and invocation mode controls

These capabilities are still the right model for durable, source-backed
knowledge.

## What To Deprioritize Or Reframe

Deprioritize these as primary runtime-learning paths:

- Manual Draft Inbox as the main place to write lessons from agent runs
- Generic Knowledge Inbox for runtime-derived troubleshooting items
- Prompt-box upload as a durable Knowledge ingestion path
- Steward Review as the only path for operational lessons

Reframe them this way:

- Draft Inbox becomes part of a broader Review Queue.
- Runtime-derived items start in Runtime Lessons and become suggestions.
- Prompt-box attachments are temporary by default.
- Steward Review remains for source-backed Library governance.

## Safety And Boundaries

The unified design keeps the existing SEKB safety contract:

- Runtime-side, explicit, default-off, and advisory
- No automatic pause, retry, hidden correction, output rewrite, or tool
  blocking
- L2 principle writes only through explicit confirmation
- Persistent SEKB state remains in OpenClaw SQLite
- Renderer does not directly call IPC or Gateway HTTP/WebSocket
- Host API and Main-owned services mediate desktop access
- User-visible UI changes require full i18n coverage for `en`, `zh`, `ja`,
  and `ru`
- User-visible UI changes require Electron E2E coverage
- Communication path changes require comms replay and compare validation

## Data Model Implications

The first design slice should avoid a schema expansion unless implementation
proves it is required.

Existing durable entities can cover the core flow:

- Library pages and drafts remain in the current Knowledge/wiki layer.
- Runtime trajectories, principles, index entries, and error signatures remain
  in SEKB tables.
- A Host API read model can combine Knowledge and SEKB state for the desktop
  UI without merging their storage models.

If later implementation needs cross-source review records, add them through a
task spec with migration tests. Do not add JSON sidecars.

## API Direction

Renderer should consume a Knowledge-owned host API, not SEKB internals.

Recommended conceptual methods:

- `knowledge.runtimeLessonsReport()`
  Returns counts, undistilled trajectories, active principles, error summaries,
  and index preview.

- `knowledge.listRuntimeLessonSuggestions()`
  Returns reviewable SEKB distillation suggestions.

- `knowledge.confirmRuntimeLessonSuggestion()`
  Confirms a suggestion through the SEKB distillation confirmation path.

- `knowledge.rejectRuntimeLessonSuggestion()`
  Records a rejection reason.

- `knowledge.exportRuntimeLessonToDraft()`
  Creates a Knowledge draft from a confirmed or suggested Runtime Lesson for
  explicit review.

- `knowledge.routeContext()`
  Evolves to accept Runtime Lessons as an eligible source while preserving
  manual, suggest, and auto-read behavior.

These names are design-level names. Implementation should match existing
Host API naming style.

## User Experience Flow

First-run or disabled state:

- Knowledge shows Library as today.
- Runtime Lessons explains that runtime learning is off or unavailable.
- No runtime advice is injected unless the runtime owner explicitly enables
  SEKB.

After SEKB captures runs:

- Runtime Lessons shows trajectory and principle counts.
- The user can inspect recent undistilled trajectories and repeated failures.
- Suggestions appear as candidates, not applied knowledge.

Review:

- The user confirms a suggestion as a Runtime Lesson principle, rejects it, or
  exports it into a Library draft.
- Confirmed Runtime Lessons become eligible for future retrieval.

Chat and agent use:

- The composer defaults to a conservative policy.
- The user can choose Library or Library plus Lessons.
- Suggestions and auto-read attach bounded visible context with provenance.
- Temporary attachments remain separate from durable Knowledge.

## Phased Implementation Plan

Phase 1: Read-only unification

- Add Host API read access for SEKB operator report.
- Add a Runtime Lessons tab or section under Knowledge.
- Show counts, undistilled trajectories, active principles, and index preview.
- Add i18n and Electron E2E for the read-only desktop workflow.

Phase 2: Reviewable Runtime Lesson suggestions

- Expose SEKB distillation suggestions through Knowledge-owned Host API.
- Add confirm and reject actions.
- Preserve `DistillationTool.confirm_and_save` as the only principle write
  path.
- Test that reject and confirm do not affect Library unless export is chosen.

Phase 3: Retrieval Controller source policy

- Add Runtime Lessons as a source class in route context.
- Keep manual, suggest, and auto-read modes.
- Add bounded budgets and provenance labels per source.
- Verify no hidden correction or automatic write behavior is introduced.

Phase 4: Composer tightening

- Make temporary attachment semantics explicit.
- Move durable upload/import affordances toward Knowledge import/review.
- Keep quick access to cite existing knowledge and select retrieval policy.
- Update E2E around chat composer knowledge controls.

Phase 5: Optional retrieval quality improvements

- Improve ranking with embeddings or rerankers only if local infrastructure
  and privacy boundaries are clear.
- Keep lexical fallback as the reliable baseline.
- Avoid external vector databases unless a later task explicitly expands
  scope.

## Validation Strategy

Design-only validation:

- Review this document for scope, contradictions, incomplete wording, and safety
  boundary drift.

Implementation validation when work begins:

- Harness context and validation for any SEKB or communication task spec.
- Focused SEKB unit/integration tests for runtime behavior.
- Host API tests for Knowledge-owned desktop access.
- Electron E2E for user-visible Knowledge or composer changes.
- i18n coverage across `en`, `zh`, `ja`, and `ru`.
- Comms replay and compare only when renderer/Main/host-api/api-client/Gateway
  delivery paths change.

## Decisions Captured

- Knowledge is retained as the product surface.
- SEKB is folded into Knowledge as Runtime Lessons and a learning layer.
- The first desktop slice should be read-only before adding confirm/reject.
- The prompt box should keep temporary attachments and retrieval controls, but
  durable Knowledge ingestion should route through Knowledge.
- Retrieval should be controlled and provenance-aware without becoming a heavy
  RAG platform in the first slice.
- SEKB remains explicit, default-off, advisory, and confirmation-gated.

## User Review Checkpoint

If this design is approved, the next step is to write an implementation plan
for Phase 1: read-only Knowledge Runtime Lessons integration. That plan should
start from the relevant harness context, define Host API boundaries, specify UI
i18n and E2E coverage, and keep unrelated runtime-memory work out of the diff.
