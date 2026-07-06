# Retrieval And Interaction Strategy

This document defines how persisted knowledge should be discovered and used by
the Knowledge page, Chat composer, runtime agents, and future guardrails.

## Current Retrieval Capabilities

The current system has:

- `hostApi.knowledge.search`
- `hostApi.knowledge.get`
- `hostApi.knowledge.routeContext`
- manual Chat reference attachment
- Chat knowledge scopes: `none`, `memory`, `wiki`, `all`
- Chat knowledge modes: `manual`, `suggest`, `auto-read`
- provenance recording through `recordKnowledgeReference`
- Knowledge Librarian modal search/get with citations

The product now has the first Chat-facing proactive retrieval loop: Suggest
mode can call `routeContext`, show a Knowledge Preflight panel, and let the
user inspect, attach, or dismiss suggestions before send. The next step is not
simply "more search"; it is making retrieval intent-aware, risk-aware, and
durable enough for triage, grounded QA, and execution-time advisory use.

## Retrieval Layers

### Layer 1: Manual Retrieval

User explicitly searches or attaches references.

Existing surfaces:

- Knowledge page search.
- Librarian modal prompt.
- Chat knowledge picker.
- `/wiki <query>` slash command.

Requirements:

- Results must show title, source path, snippet, and corpus.
- Attach action must be visible and reversible.
- Attached references must be visible as chips before send.
- References used in Chat must be recorded as provenance.

### Layer 2: Suggest Retrieval

The system proposes references, but the user chooses whether to attach them.

Implemented surface:

- Chat composer routeContext suggestions in `suggest` mode.
- Compact Knowledge Preflight panel with attach, inspect, and dismiss actions.
- Visible chips for attached suggestions before send.
- Per-input/session dismissal memory so dismissed suggestions do not reappear
  for the same draft.

Required next upgrade:

- routeContext should search both ordinary knowledge and structured
  error-experience cards.
- Suggestions should keep using the existing grouped panel while improving
  ranking and explanations for:
  - related docs
  - likely pitfalls
  - applicable rules
  - recent similar work
- The panel should expose usefulness signals for attach, dismiss, and
  sent-with-reference outcomes.

Recommended UI copy:

```text
Knowledge Preflight
2 related docs, 1 prior pitfall, 1 rule may apply.
```

Actions:

- Attach all
- Inspect
- Dismiss
- Disable for this turn

### Layer 3: Auto-Read Retrieval

The system automatically reads bounded snippets before sending to the runtime.

Existing behavior:

- In `auto-read`, selected/routed references can be read before `chat.send`.

Rules:

- Auto-read must be bounded by character/token caps.
- Auto-read should prefer approved/applied knowledge.
- Auto-read may include raw/draft items only if clearly labeled as unreviewed.
- Auto-read must never grant write permission.
- Auto-read failure must not fail ordinary Chat send.

### Layer 4: Execution-Time Guard

Future feature. The system detects an active failure or repeated mistake during
agent execution and retrieves a matching experience card.

Signals:

- build/typecheck/lint/test failure
- repeated edit to same file/line/module
- user correction such as "not right", "redo", "this is wrong"
- rollback/retry behavior
- stack trace or command output matching known signatures

Initial behavior should be advisory:

```text
Potential known pitfall matched:
"Do not call knowledge writes directly from renderer."

Suggested resolution:
Use src/lib/host-api.ts and electron/services/knowledge-api.ts.
```

Do not pause or rewrite the agent automatically in the MVP. First ship it as a
visible advisory and collect usefulness signals.

False-positive handling:

- A false positive is an advisory that matched a failure or command context but
  did not help the current task, was explicitly dismissed as irrelevant, or was
  contradicted by later successful evidence for the same command/path.
- The MVP advisory must never become a hidden instruction, automatic pause,
  retry, rollback, or tool block. A false positive can only cost UI attention.
- Matching should require at least two independent hints before surfacing a
  high-visibility advisory, for example a failure signature plus a file/path
  overlap, or a known error-experience trigger plus a matching command family.
- Single weak hints should stay in a low-priority "possible match" bucket or be
  withheld until repeated.
- Dismissal is feedback, not failure. Repeated dismissals should reduce the
  card's default visibility and create a Steward triage item instead of raising
  louder warnings.
- Acceptance, dismiss, ignored, and contradicted-later outcomes must be tracked
  separately. Do not collapse them into one "hit" counter.
- A future stronger guard needs a false-positive review packet with examples of
  expected edits, expected deletions, slow tests, dev-server-like long-running
  commands, and legitimate fixture mutations that must not trigger blocking.

## Knowledge Preflight

Knowledge Preflight is the completed baseline UI in Chat composer. It is still
bounded to pre-send suggestion and attachment; it is not an execution-time
guard and it does not write knowledge.

Trigger:

- `knowledgeMode === 'suggest'`
- non-empty input
- no manual selected references
- input is not a slash command
- debounce routeContext

Inputs:

- user message
- workspace id
- current session key
- knowledge scope
- selected references

Outputs:

- related references
- error-experience matches
- rules/conventions
- confidence and reason

Display:

```text
Knowledge Preflight
Similar work previously failed because Vite build warnings were treated as hard errors.
[Attach] [Inspect] [Dismiss]
```

Acceptance:

- User can attach/dismiss suggestions.
- Suggestions are not hidden instructions.
- Dismissed route key is remembered for the current input/session.
- Attached suggestions become visible chips.

Current coverage anchors:

- `tests/unit/chat-input.test.tsx` covers rendering, grouped inspection,
  attach, dismiss, selected chips, and routeContext failure fallback.
- `tests/e2e/knowledge-hub.spec.ts` covers the dedicated scope trigger and
  `/wiki` attachment flow.
- `tests/e2e/knowledge-ux-cdp.spec.ts` dogfoods CDP page actions against the
  Knowledge UX shape.

## Librarian Modal Strategy

The Librarian modal should remain a focused knowledge subsystem, not a second
full Chat page.

Current strengths:

- Markdown rendering.
- Prompt textarea.
- Citations.
- Retryable errors.
- Prompt suggestions.
- Local checkpoint.

Next upgrades after Chat preflight:

1. Add "source-grounded answer" structure:
   - Answer
   - Sources used
   - Unknowns / missing sources
   - Suggested draft action

2. Add "create structured card" action:
   - From the current conversation, create an Inbox candidate.
   - If the answer describes a mistake, create an ErrorExperience candidate.

3. Add "inspect retrieval" affordance:
   - show query used
   - show corpus
   - show why each result was selected

4. Later: connect to real runtime `knowledge-librarian` role.

Do not add file editing, tool execution, or general-purpose chat tools inside
the Librarian modal.

## Steward Interaction Strategy

Steward should run in three places:

1. Draft review.
2. Inbox triage.
3. Governance/Audit Center.

Future Inbox triage output:

```ts
type StewardTriage = {
  action: 'needs-decision' | 'merge-duplicate' | 'observe' | 'ready-for-review' | 'reject-low-value';
  confidence: number;
  duplicateOf?: string;
  conflictWith?: string[];
  reason: string;
  suggestedEdits?: string[];
};
```

The Inbox UI should sort by:

1. conflicts / needs-decision
2. high-confidence reusable knowledge
3. duplicate merge suggestions
4. observe / low-value items

## Source-Grounding Requirements

For any assistant-facing answer that claims to be knowledge-grounded:

- cite at least one source or explicitly say no source was found
- distinguish source fact from inference
- keep unsupported suggestions in a "suggestion" section
- expose source paths
- record provenance when the source is used

## Comparison With Mainstream Approaches

### NotebookLM

Adopt:

- source-grounded answers
- citation-first UI
- source set transparency

Avoid for now:

- pretending current search is passage-level verified grounding
- broad multimodal ingestion before Markdown/wiki quality is solid

### Obsidian

Adopt:

- Markdown-first editing
- backlinks/tags later
- user-visible local files

Avoid for now:

- building a full plugin ecosystem
- replacing governance with freeform note editing

### Cursor/Cline/Windsurf Memory Bank

Adopt:

- layered context
- rules vs memories vs active context
- repeated pitfall capture

Avoid for now:

- always injecting large memory files
- letting memories override explicit user instructions

### RAGFlow/LlamaIndex/Dify

Adopt later:

- hybrid retrieval
- rerank
- chunk-level evaluation
- retrieval quality metrics

Avoid in P0:

- adding a vector database before the product loop is validated

## Non-Goals

- No autonomous correction loop in P0.
- No hidden runtime interruption in P0.
- No unbounded context injection.
- No automatic apply.
- No separate RAG platform UI before Knowledge Hub workflow is stable.
