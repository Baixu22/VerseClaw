# Knowledge Persistence Development Plan

This folder is the handoff package for the next development window of the
ClawX Knowledge Hub. It converts the current Knowledge page and Chat knowledge
hooks into a staged plan for durable, reviewable, reusable project knowledge.

## Current Product Shape

ClawX already has a local Knowledge Hub with three important qualities:

1. It is Markdown/wiki-first.
2. It is role-governed: agents can read and propose, but durable writes require
   review and user confirmation.
3. It is connected to Chat through knowledge scopes, selected references,
   routeContext suggestions, and save-to-knowledge drafts.

The current implementation is not yet a full Obsidian clone, NotebookLM clone,
or RAG platform. It is closer to a governed local knowledge control plane:

```text
Chat / user / agent output
  -> Knowledge Inbox
  -> Draft
  -> Steward Review
  -> Proposal
  -> User confirmation
  -> wiki.apply / durable knowledge
```

The next development should preserve that governance model while making the
system more proactive: knowledge should not only be stored, it should be
triggered at the right time.

## Operating Principle: Run-Through First

Knowledge architecture notes are guidance, not a reason to force risky code
alignment. When this plan disagrees with the current stitched-together runtime,
the priority order is:

1. Keep Chat, Knowledge, and ordinary runtime flows runnable.
2. Preserve existing renderer/Main/runtime boundaries and fallback behavior.
3. Record the architecture drift explicitly in the relevant doc or phase notes.
4. Add the smallest validation that proves the current flow still works.
5. Defer broad code reshaping until a focused spec, rollback path, and full
   enough test path exist.

In practice, a phase is allowed to accept compatibility shims, degraded modes,
or docs corrections when they keep the system moving. It should not require
large code rewrites merely to match an aspirational architecture diagram.

## Status Update: 2026-07-04

Completed baseline work now covers the Chat-facing proactive knowledge loop:

- Chat has a dedicated Knowledge scope trigger again (`None`, `Memory`, `Wiki`,
  `All`) plus Manual / Suggest / Auto-read invocation modes.
- `/wiki` opens knowledge search from the slash palette and attaches selected
  wiki references as visible chips before send.
- Suggest mode can render a compact Knowledge Preflight panel from
  `routeContext` results, group related docs/pitfalls/rules, and let the user
  inspect, attach, or dismiss suggestions without turning them into hidden
  instructions.
- RouteContext failure is best-effort: Chat remains usable and send is not
  blocked by a failed knowledge side effect.
- Knowledge Steward configuration and review are visible through the Knowledge
  page review surface, including the configurable steward role slot.
- The Electron CDP remote-control developer API can inspect status/targets and
  drive pageInfo, screenshot, scroll, and selector/coordinate click actions for
  dogfooding Knowledge UX flows.

Evidence anchors for this status are the focused Chat/Knowledge/CDP tests:
`tests/unit/chat-input.test.tsx`, `tests/unit/knowledge-api.test.ts`,
`tests/unit/knowledge-page.test.tsx`, `tests/unit/remote-control-api.test.ts`,
`tests/unit/settings-page-remote-control.test.tsx`,
`tests/e2e/knowledge-hub.spec.ts`, `tests/e2e/knowledge-ux-cdp.spec.ts`, and
`tests/e2e/knowledge-steward-config.spec.ts`.

## Next Components

The next development window should focus on components that turn the completed
preflight loop into a durable learning workflow:

0. **Run-through Stabilization**: before expanding architecture, verify the
   existing Chat -> Knowledge -> Draft/Proposal and Knowledge Preflight flows
   still run with the current code. If docs and runtime disagree, document the
   drift and add a compatibility note instead of forcing a large refactor.
1. **Steward Triage for Inbox**: group pending items by action priority, surface
   duplicate/conflict/incomplete diagnoses, and add merge/dismiss/promote flows
   without silent wiki writes.
2. **Librarian Grounded QA**: connect answers to a bounded grounded role or host
   route, enforce Answer/Sources/Unknowns/Suggested next action sections, and
   let users create reviewable drafts or error-experience candidates from an
   answer.
3. **Execution-Time Advisory Guard**: detect known command/test/build failures
   and surface matching experience cards as advisory UI only; do not pause,
   rewrite, or block agent execution in the MVP. The first version must track
   false positives separately from useful dismissals, suppress repeated
   irrelevant matches, and require a separate false-positive corpus before any
   stronger guard is considered.
4. **Retrieval Quality Metrics**: add fixtures and dashboard signals for stale,
   low-confidence, duplicate, source-gap, and high-dismissal knowledge.
5. **CDP Remote-Control Productization**: keep the current developer API, then
   add token/origin policy, explicit audit records, target selection UX, and
   permission constraints before exposing a broader broker or MCP bridge.

## Planning Documents

- [01-boundaries-and-roles.md](01-boundaries-and-roles.md)
  Defines the hard safety/product boundaries, especially Librarian vs Steward vs
  Chat vs runtime agent responsibilities.

- [02-data-model-and-persistence.md](02-data-model-and-persistence.md)
  Defines the persistent data types needed for structured knowledge, especially
  error-experience cards and provenance.

- [03-retrieval-and-interaction-strategy.md](03-retrieval-and-interaction-strategy.md)
  Defines how Knowledge Hub should interact with Chat, routeContext, the
  Librarian modal, and future runtime guards.

- [04-phased-implementation-and-acceptance.md](04-phased-implementation-and-acceptance.md)
  Breaks the work into phases with acceptance criteria, tests, and explicit
  non-goals.

- [05-ui-plan.md](https://github.com/Baixu22/VerseClaw/blob/a2a21463dccfdf98460086b1730401093a31bf10/docs/enhancements/knowledge-persistence/05-ui-plan.md)
  Describes the Knowledge page, Librarian modal, Chat composer, and Inbox UI
  changes needed for the persistence plan.

## Highest-Level Objective

Turn the Knowledge Hub from a passive archive into an active learning loop:

```text
Structured capture
  -> pattern-aware retrieval
  -> layered context injection
  -> human-reviewed persistence
  -> effectiveness tracking
  -> promotion / merge / decay
```

The immediate goal is not autonomous writing. The immediate goal is repeat-error
prevention with explicit sources and reversible user decisions.

## Existing Implementation Anchors

The next developer should start from these areas:

- `src/pages/Knowledge/index.tsx`
  Knowledge workspace, Markdown editor, Inbox/Drafts/Review/Governance, and
  Knowledge Librarian modal.

- `src/pages/Chat/ChatInput.tsx`
  Knowledge scope/mode controls, `/wiki`, `/memory`, `/all`, `/scope`,
  `/knowledge-mode`, manual knowledge attachment, and routeContext suggestions.

- `src/pages/Chat/index.tsx`
  Save-to-Knowledge draft/proposal dialog.

- `src/lib/host-api.ts`
  Renderer boundary for all knowledge actions.

- `electron/services/knowledge-api.ts`
  Main-process knowledge API implementation: search/get, inbox, drafts,
  proposals, steward review, provenance, routeContext, governance.

- `harness/specs/rules/chat-loop-boundary.md`
  Hard rule: ordinary Chat knowledge writes must be best-effort side effects and
  must not directly apply durable knowledge.

## Product North Star

When a user or agent starts a task, ClawX should answer:

1. What knowledge is relevant?
2. What similar mistakes happened before?
3. What rule or convention must not be missed?
4. What source supports the suggestion?
5. What should be saved after the task completes?

The user should see enough to trust and edit the system, but not be forced to
manually curate every low-value item.
