# Knowledge Boundaries And Roles

This document defines the product and engineering boundaries for Knowledge Hub
persistence. Future implementation should treat these as constraints, not
preferences.

## Hard Boundary

Agents may help create knowledge, but agents must not silently mutate durable
knowledge.

Allowed automatic outputs:

- Knowledge Inbox item
- Draft
- Proposal
- Provenance record
- Steward review metadata
- Route suggestion
- Error-experience candidate

Forbidden without explicit user confirmation:

- `wiki.apply`
- `applyReviewedChange`
- archive/delete/merge durable wiki pages
- silently changing approved knowledge
- treating knowledge scope as permission escalation
- using renderer UI state to bypass Main/runtime policy

This aligns with `harness/specs/rules/chat-loop-boundary.md`.

## Role Split

### Knowledge Librarian

The Librarian is the read-side assistant.

Primary users:

- Human user reading or editing the Knowledge page.
- Chat composer looking for relevant references.
- Agent that needs local knowledge before acting.

Capabilities:

- Search wiki/memory/all corpora.
- Read pages or bounded snippets.
- Summarize with citations.
- Explain current Markdown document.
- Find related pages.
- Suggest tags, titles, backlinks, and missing sources.
- Create a draft or Inbox item when explicitly asked.
- Request Steward review.

Non-capabilities:

- No direct durable write.
- No apply.
- No delete/archive/merge.
- No hidden long-running autonomy.
- No authority over runtime permissions.

Future upgrade:

- Move from local retrieval composition to grounded LLM QA, but keep citations
  and write boundaries.

### Knowledge Steward

The Steward is the quality and governance role.

Primary users:

- Knowledge Inbox.
- Draft review.
- Governance/Audit Center.
- Future background triage.

Capabilities:

- Classify drafts and Inbox items.
- Check source coverage.
- Detect duplicates.
- Detect conflicts.
- Detect stale claims.
- Suggest merges or archive candidates.
- Rank Inbox items by confidence and actionability.
- Mark items as "needs decision", "observe", "duplicate", or "ready for review".

Non-capabilities:

- No final apply without user confirmation.
- No silent deletion.
- No unbounded rewrite of existing knowledge.

Future upgrade:

- Add semantic pass and dedupe/merge clustering, but keep the user as final
  confirmation authority.

### Main Chat

Main Chat is the task execution surface, not the durable knowledge source of
truth.

Capabilities:

- Select `knowledgeScope`: `none`, `memory`, `wiki`, `all`.
- Select `knowledgeMode`: `manual`, `suggest`, `auto-read`.
- Attach explicit knowledge references.
- Request routeContext suggestions.
- Send knowledge references as read-only context.
- Save useful chat material to Knowledge Draft/Proposal.
- Record provenance for references used.

Non-capabilities:

- Chat send must not fail because a knowledge side effect fails.
- Chat knowledge scope must not grant new tools or permissions.
- Chat must not directly apply durable knowledge.

### Runtime Agent

Runtime agents may use knowledge as read-only context and may propose knowledge
updates.

Allowed:

- Search/read knowledge.
- Create Inbox candidates after task completion.
- Create structured error-experience candidates.
- Cite knowledge references in task evidence.

Not allowed:

- Direct durable wiki mutation.
- Applying a proposal without user confirmation.
- Treating retrieved knowledge as a hidden instruction that overrides user
  permissions or system policy.

## Boundary Matrix

| Operation | User | Librarian | Steward | Main Chat | Runtime Agent |
| --- | --- | --- | --- | --- | --- |
| Search knowledge | Yes | Yes | Yes | Yes | Yes |
| Read page/snippet | Yes | Yes | Yes | Yes | Yes |
| Create Inbox item | Yes | Suggest/explicit | Yes | Best effort | Best effort |
| Create Draft | Yes | Explicit only | Yes | Explicit dialog | Best effort/proposed |
| Review Draft | Yes | No | Yes | No | No |
| Create Proposal | Yes | Explicit only | Yes | Explicit dialog | Best effort/proposed |
| Apply durable wiki write | Yes | No | No | No | No |
| Delete/archive/merge durable pages | Yes, confirmed | No | Proposal only | No | No |
| Change runtime permission | User/settings only | No | No | No | No |

## Trust Levels

Knowledge should carry trust metadata instead of being treated as equally valid.

Recommended trust levels:

- `raw`: captured but not reviewed.
- `draft`: user/agent drafted, not yet steward-reviewed.
- `steward_reviewed`: checked for source/conflict/freshness.
- `approved`: user approved.
- `applied`: durable wiki write completed.
- `deprecated`: retained but should not be injected by default.

Route and injection logic should prefer higher trust levels and make lower trust
levels visible as lower-confidence hints.

## Product Principle

The system should help the user avoid repeated mistakes without creating a
second invisible authority. Every durable knowledge mutation needs a visible
reason, source, and confirmation path.
