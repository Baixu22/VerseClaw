# Knowledge Persistence UI Plan

This document describes the user-facing UI changes needed to support durable,
structured, and proactive knowledge persistence.

## Design Intent

The Knowledge Hub UI should feel like a workbench for reading, writing, and
governing reusable knowledge. It should not feel like an audit console by
default, and it should not hide important source and review state behind an
assistant answer.

The UI should make three things obvious:

1. What knowledge exists.
2. Why a piece of knowledge was suggested.
3. What will happen if the user accepts it.

## Knowledge Page

Current layout:

- Overview cards.
- Library/Inbox/Drafts/Review tabs.
- Audit Center secondary entry.
- Library workspace with left vault/sidebar, center Markdown editor, right
  Librarian context panel.

Recommended additions:

### Knowledge Type Filter

Add visible categories for:

- Documents
- Decisions
- Procedures
- Troubleshooting
- Error Experiences
- Rules
- Drafts
- Review Queue

The first implementation can map Error Experiences to existing
`troubleshooting` type plus metadata, but the UI should label them clearly.

### Current Document Context

Right panel should show:

- source path
- type
- tags
- summary
- backlinks/related pages when available
- provenance status
- review status

### Structured Candidate Form

For error-experience candidates, provide a compact structured form:

- Title
- Trigger
- Root cause
- Resolution steps
- Anti-pattern
- Correct pattern
- File patterns
- Keywords
- Verification commands
- Confidence

This can begin as an Inbox/Draft detail editor. Do not require a complex custom
editor in P0.

## Librarian Modal

Current modal already has:

- assistant/user messages
- Markdown rendering
- prompt textarea
- citations
- copy
- loading
- retryable error card
- suggestions
- local checkpoint

Recommended next UI changes:

### Grounded Answer Layout

Assistant messages should render structured sections:

```text
Answer
Sources
Unknowns
Suggested next action
```

The system should not bury missing-source warnings in prose.

### Create Candidate Actions

For relevant answers, show action buttons:

- Save as Draft
- Create Error Experience
- Send to Steward

These actions should open a reviewable form before writing.

### Retrieval Inspector

Add a small "Sources used" or "Retrieval" disclosure:

- query
- corpus
- roleTag
- result count
- source list
- snippet preview

This helps debug why the Librarian answered a certain way.

### Empty State

The empty state should orient the user:

- ask about current note
- find related pages
- check missing sources
- create an experience card

Avoid long instructional text. Use short prompt chips.

## Chat Composer

Current Chat composer already has:

- knowledge quick toggle
- knowledge scope menu
- knowledge mode menu
- manual knowledge search
- selected knowledge chips
- suggested knowledge references

Implemented baseline UI: Knowledge Preflight.

### Knowledge Preflight Card

When routeContext finds matches, show a compact panel above the composer:

```text
Knowledge Preflight
1 prior pitfall and 2 related docs may apply.

[Attach] [Inspect] [Dismiss]
```

Expanded state:

- Prior pitfalls
- Related docs
- Rules/conventions
- Why matched
- Source/corpus

Each item should have:

- title
- one-line reason
- trust/status badge
- attach/remove action

Current status:

- The compact composer panel exists and exposes Attach, Inspect, and Dismiss.
- Expanded inspection groups suggestions by related docs, prior pitfalls, and
  rules/conventions when those groups are returned.
- Attached suggestions become visible chips and can be removed before send.
- Dismissal is remembered for the current input/session route key.
- RouteContext failure leaves Chat send available.

Remaining UI work:

- Add stronger type/trust badges for structured error-experience cards.
- Show provenance counters for accepted, dismissed, and sent-with-reference
  outcomes.
- Add quality/empty/error states for sparse routeContext results beyond the
  current compact suggestion state.

### Modes Should Be Understandable

`manual`, `suggest`, and `auto-read` should be explained in tooltips or menu
descriptions:

- Manual: only use what the user attaches.
- Suggest: recommend relevant knowledge before send.
- Auto-read: read bounded snippets automatically when relevant.

Do not make modes imply write permissions.

## Inbox UI

Current Inbox is a list/detail review area.

Recommended additions:

### Triage Groups

Group Inbox items by:

- Needs decision
- Ready for review
- Possible duplicate
- Observe
- Low value

### Error Experience Badge

Structured cards should show:

- severity
- confidence
- trigger type
- source session/task
- last verified
- false-positive state:
  - dismissed as irrelevant
  - contradicted by later success
  - repeated dismissal
  - weak signal only

False-positive UI rules:

- A card with repeated irrelevant dismissals should move toward Observe or Low
  value, not stay in Needs decision.
- A contradicted card should show the successful command/test evidence that
  contradicted it before the user decides whether to edit, demote, or dismiss.
- Weak-signal cards should avoid alarming language and should not appear in
  Chat as high-confidence preflight/advisory suggestions.
- The UI should make "not useful here" a first-class dismissal reason so the
  system can separate false positives from valid cards the user simply chose
  not to attach.

### Decision Actions

Each Inbox item should support:

- Promote to Draft
- Edit
- Dismiss
- Merge duplicate
- Mark observe

Avoid showing all low-value items as equally urgent.

## Draft And Review UI

Draft detail should show:

- editable Markdown projection
- structured metadata summary
- source refs
- Steward warnings
- provenance
- proposal status

For error-experience drafts, show both:

- human-readable Markdown
- structured card fields

The user should not need to understand JSON metadata to review a card.

## Governance UI

Audit Center should remain secondary, but gain knowledge-health signals:

- stale high-hit cards
- duplicates
- conflicts
- source gaps
- unreferenced docs
- low-confidence cards with many hits

Do not put governance first for normal reading/writing workflows.

## UI Acceptance Checklist

For each new UI:

- All display text is i18n-backed.
- Main user actions have stable `data-testid`.
- No card-in-card layouts.
- Compact panels use restrained typography.
- Buttons use icons where appropriate.
- Loading/error/empty states are visible.
- User can undo/remove suggestions before send.
- A failed knowledge side effect does not break Chat send.
- Electron E2E covers the visible workflow.

## First UI Slice

Completed baseline:

- Create Error Experience action in the Librarian modal.
- Knowledge Preflight compact panel in Chat composer.
- Inspect/dismiss/attach actions for preflight suggestions.
- Visible selected knowledge chips before send.

Next UI slice:

1. Finish Error Experience badge/rendering in Inbox detail with confidence,
   source, trigger type, and last verified metadata.
2. Add Steward triage groups and duplicate/conflict decision actions.
3. Harden Librarian grounded answer layout and retrieval inspector.
4. Add Knowledge quality metrics for high-dismissal, stale, duplicate, and
   source-gap items.

The completed baseline and next UI slice keep the user-facing loop explicit:

```text
prior mistake captured
  -> suggested before similar task
  -> accepted/dismissed
  -> effectiveness tracked
```
