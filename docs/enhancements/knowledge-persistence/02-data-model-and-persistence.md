# Data Model And Persistence Plan

This document defines the persistent data additions needed to make Knowledge Hub
useful for repeated-error prevention and durable project learning.

## Current Persistence Shape

The current system already has these durable or semi-durable concepts:

- Wiki pages through OpenClaw `memory-wiki`.
- Knowledge Inbox items.
- Knowledge Drafts.
- Knowledge Change Proposals.
- Steward review data on drafts.
- Provenance records through `recordKnowledgeReference`.
- Audit records in the knowledge service.
- Local Librarian modal checkpoint in `localStorage`.

The next phase should extend this model, not create a parallel memory system.

## New First-Class Knowledge Kind: Error Experience

The most important missing concept is a structured repeated-error card. Freeform
Markdown lessons are useful for reading, but weak for triggering.

Recommended type:

```ts
type KnowledgeExperienceKind =
  | 'error-experience'
  | 'rule'
  | 'gotcha'
  | 'workflow'
  | 'pattern'
  | 'anti-pattern'
  | 'module-context';
```

For the first implementation, only `error-experience` is required.

## ErrorExperienceCard Schema

```ts
type ErrorExperienceCard = {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;

  triggerPattern: {
    errorType: 'compile' | 'runtime' | 'lint' | 'test' | 'logic' | 'convention' | 'architecture' | 'ui-regression';
    keywords: string[];
    filePatterns: string[];
    stackTraceSignature?: string;
    commandSignature?: string;
    scenarioDescription: string;
    routeQueries: string[];
  };

  rootCause: {
    summary: string;
    contributingFactors: string[];
  };

  resolution: {
    steps: string[];
    antiPattern?: string;
    correctPattern?: string;
    codeSnippet?: string;
    verificationCommands: string[];
  };

  applicability: {
    projectScopes: string[];
    modules: string[];
    roles: string[];
    confidence: number;
    severity: 'low' | 'medium' | 'high' | 'blocking';
  };

  provenance: {
    createdFrom: {
      kind: 'chat-session' | 'task-ledger' | 'manual' | 'test-run' | 'runtime-event';
      id: string;
      label?: string;
    };
    sourceRefs: Array<{
      id: string;
      kind: string;
      label?: string;
      path?: string;
    }>;
    createdAt: string;
    lastVerifiedAt?: string;
  };

  effectiveness: {
    hitCount: number;
    acceptedCount: number;
    dismissedCount: number;
    preventedFailureCount: number;
    staleCount: number;
  };
};
```

## Storage Strategy

Do not create a separate database for the first phase.

Recommended MVP storage:

1. Store candidates as Knowledge Inbox items.
2. Use `type: 'troubleshooting'` initially if adding a new enum is too broad.
3. Add `metadata.errorExperience` with the structured card payload.
4. Promote to Draft with the structured metadata preserved.
5. Apply to wiki as a readable Markdown page with embedded frontmatter or
   metadata references.

When the model stabilizes, promote `error-experience` to a first-class
`KnowledgeDraftType`.

## Markdown Projection

Every structured card should have a readable Markdown projection so humans can
inspect and edit it.

Recommended page format:

```md
---
type: error-experience
schemaVersion: 1
confidence: 0.82
severity: high
filePatterns:
  - src/pages/Knowledge/**
keywords:
  - routeContext
  - knowledgeScope
lastVerifiedAt: 2026-07-04T00:00:00.000Z
---

# Error Experience: Knowledge route suggestions do not trigger

## Trigger

...

## Root Cause

...

## Resolution

...

## Verification

...

## Anti-pattern

...

## Correct pattern

...
```

## Provenance Requirements

Each persistent item should answer:

1. Where did this come from?
2. What evidence supports it?
3. Who or what reviewed it?
4. When was it last verified?
5. Has it actually helped?

Use `recordKnowledgeReference` for read/use events and add follow-up
effectiveness updates in a later phase.

## Effectiveness Tracking

MVP counters:

- `hitCount`: routeContext or guard matched the card.
- `acceptedCount`: user/agent accepted the suggestion.
- `dismissedCount`: user dismissed the suggestion.
- `preventedFailureCount`: after applying suggestion, relevant test/build passed.
- `staleCount`: suggestion was shown but no longer applied or was contradicted.

Do not over-automate these counters at first. Start with explicit UI actions and
known signals:

- user clicks "use"
- user clicks "dismiss"
- same command/test passes after card was injected
- user says "not relevant"

## Migration Strategy

Phase 0 should avoid migrations.

Use metadata-based persistence first:

```ts
metadata: {
  knowledgeKind: 'error-experience',
  errorExperience: ErrorExperienceCard
}
```

Phase 1 can add stronger shared contract types and i18n/UI rendering.

Phase 2 can add search indexes, ranking, and health dashboards.

## Validation Rules

An error-experience card is valid only if:

- title is non-empty
- summary is non-empty
- triggerPattern has at least one keyword, file pattern, stack trace signature,
  command signature, or route query
- rootCause summary is non-empty
- resolution has at least one step
- provenance has at least one source reference or createdFrom id
- confidence is between 0 and 1

Invalid cards may still enter Inbox as raw candidates, but Steward should mark
them as incomplete.

## Non-Goals

- No vector database in the first phase.
- No autonomous durable apply.
- No hidden memory writes.
- No replacing existing Draft/Proposal workflow.
- No forcing every knowledge item into the error-experience schema.
