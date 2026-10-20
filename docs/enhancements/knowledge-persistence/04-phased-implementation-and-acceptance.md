# Phased Implementation And Acceptance

This document breaks Knowledge persistence into implementable phases. Each phase
has scope, non-goals, and acceptance criteria.

## Status update: 2026-10-20

- Phase 1 retrieval is now available through the Library, Review Queue, Runtime Lessons, Governance, and SourceSet/Studio module split.
- Runtime Lessons are an explicit `routeContext` source policy with visible provenance; default requests remain without SEKB injection.
- Phase 5 semantic retrieval has a real provider boundary (SiliconFlow Qwen3 Embedding 8B) and preserves lexical fallback.
- `wiki_apply` is operator-gated and is not exposed to ordinary agents by default.
- Agent-driven E4 cohort evidence records three-task real repository outcomes for explicit refs, automatic retrieval, and SEKB retrieval (Hit@1/Hit@3/MRR 1.000 per surface); it is not real-human evidence.

## Phase 0: Structured Capture MVP

Goal:

Make repeated-error knowledge persist as structured candidates without changing
runtime behavior.

Scope:

- Define `metadata.knowledgeKind = 'error-experience'`.
- Define `metadata.errorExperience` payload.
- Add validation helpers in the knowledge service or shared helper module.
- Add create/edit rendering in Knowledge Inbox/Draft UI.
- Allow manual creation from Knowledge page or Librarian modal.
- Preserve structured metadata when promoting Inbox item to Draft.
- Add readable Markdown projection.

Non-goals:

- No vector search.
- No runtime guard.
- No auto apply.
- No new database.
- No forced enum migration unless low-risk.

Acceptance:

- User can create an error-experience candidate.
- Candidate appears in Inbox with structured fields visible.
- Candidate can be promoted to Draft.
- Draft preserves structured metadata.
- Invalid candidates are marked incomplete, not silently dropped.
- No durable wiki write happens without explicit user confirmation.

Status as of 2026-07-04:

- Baseline structured metadata, draft/proposal preservation, Markdown
  projection, Librarian save-draft/create-error-experience/send-to-steward
  actions, and Knowledge page rendering are present in the API/UI test surface.
- Remaining Phase 0 hardening is a dedicated Electron E2E for manual
  error-experience creation from the Librarian modal and explicit fixture
  coverage for invalid/incomplete candidate rendering.

Suggested tests:

- Unit: validation accepts/rejects expected payloads.
- Unit: Inbox create/promote preserves `metadata.errorExperience`.
- Unit: Markdown projection includes trigger/root cause/resolution.
- E2E: user creates an error-experience candidate and sees it in Inbox.

## Phase 1: Knowledge Preflight In Chat

Goal:

Make routeContext proactively surface relevant docs and prior pitfalls before a
task is sent.

Scope:

- Extend `routeContext` to include structured error-experience candidates.
- Return grouped candidates:
  - docs
  - pitfalls
  - rules
- Add compact Knowledge Preflight UI under Chat composer.
- Allow attach/inspect/dismiss.
- Record provenance when user attaches or sends with suggestions.

Non-goals:

- No execution-time interruption.
- No hidden injection of dismissed suggestions.
- No auto write.

Acceptance:

- In `suggest` mode, typing a relevant task shows Knowledge Preflight.
- User can inspect why a pitfall matched.
- User can attach a suggestion and it becomes a visible chip.
- User can dismiss and it does not reappear for the same input/session.
- If routeContext fails, Chat remains usable.

Status as of 2026-07-04:

- The Chat composer baseline is complete: Suggest mode shows Knowledge
  Preflight, exposes inspect/attach/dismiss, keeps attached suggestions visible
  as chips, and treats routeContext failure as best-effort.
- The dedicated Knowledge scope trigger is restored and covered by the
  Knowledge E2E flow.
- `/wiki` slash attachment is covered by unit and E2E flows.
- Remaining Phase 1 work is retrieval quality rather than UI mechanics:
  richer error-experience ranking, stable provenance counters for
  attach/send/dismiss outcomes, and fixture-based routeContext quality metrics.

Suggested tests:

- Unit: routeContext returns grouped candidates.
- Unit: ChatInput renders Knowledge Preflight and attach/dismiss actions.
- E2E: typing a task shows a pitfall suggestion and attach creates a visible
  knowledge chip.
- E2E: routeContext failure does not block sending.

## Phase 2: Steward Triage For Inbox

Goal:

Prevent Inbox from becoming a dumping ground by automatically sorting and
diagnosing candidates.

Status as of 2026-07-04:

- This is the next primary Knowledge component. The page has Steward review and
  configuration surfaces, but Inbox triage grouping, duplicate/conflict merge
  workflows, and low-value/observe prioritization should be treated as the next
  implementation slice.

Scope:

- Add triage metadata:
  - action
  - confidence
  - duplicateOf
  - conflictWith
  - reason
  - suggestedEdits
- Run heuristic Steward triage when listing or creating Inbox items.
- Add UI grouping:
  - Needs decision
  - Ready for review
  - Possible duplicate
  - Observe
  - Low value
- Add merge/dismiss/promote flows for duplicate candidates.

Non-goals:

- No silent merge into durable wiki.
- No background infinite processing.
- No semantic LLM triage unless explicitly configured.

Acceptance:

- New Inbox items receive triage metadata.
- Inbox defaults to decision/action priority order.
- Duplicate candidates can be inspected and dismissed/merged into a draft.
- Conflicting candidates are visually distinct.
- User can still manually edit/promote/dismiss.

Suggested tests:

- Unit: triage classifies duplicates/conflicts/incomplete cards.
- Unit: listInboxItems returns stable ordering.
- E2E: Inbox shows triage groups and duplicate action.

## Phase 3: Librarian Grounded QA

Goal:

Upgrade the Librarian modal from local retrieval composition to a bounded,
source-grounded assistant role.

Status as of 2026-07-04:

- The modal has the local UI foundation: citations, retryable errors,
  retrieval inspection, save-draft, create-error-experience, and send-to-steward
  actions. The grounded assistant role/host route and enforced answer contract
  remain open.

Scope:

- Connect modal to a real `knowledge-librarian` role or dedicated host route.
- Enforce answer sections:
  - Answer
  - Sources
  - Unknowns
  - Suggested next action
- Keep citations visible.
- Add "create draft" and "create error-experience candidate" from answer.
- Add retrieval inspection.

Non-goals:

- No general Chat replacement.
- No arbitrary tools in modal.
- No direct apply.

Acceptance:

- Librarian can answer with citations using real source text.
- Unsupported claims are labeled as suggestions or unknowns.
- User can create a Draft/Inbox candidate from an answer.
- Errors are retryable and do not corrupt local checkpoint.
- Modal remains usable without provider keys by falling back to local retrieval
  where possible.

Suggested tests:

- Unit: answer formatter enforces sections.
- Unit: create candidate from answer maps sources/provenance.
- E2E: Librarian answer displays sources and can create an Inbox candidate.

## Phase 4: Advisory Execution-Time Error Guard

Goal:

Detect repeated mistakes during execution and surface relevant experience cards
without blocking the agent automatically.

Scope:

- Add lightweight matcher for command/test/lint/build failures.
- Match against error-experience trigger patterns.
- Emit advisory event or UI notice.
- Allow user/agent to accept/dismiss.
- Track hit/dismiss/accepted counters.
- Track false-positive outcomes separately:
  - dismissed as irrelevant
  - ignored/no action
  - contradicted by later success
  - matched only a weak signal
  - suppressed by repeated dismissal

Non-goals:

- No automatic pause/rewrite in MVP.
- No model confidence token inspection.
- No destructive tool blocking.
- No escalation from advisory to blocking without a separate false-positive
  corpus, default-off flag, rollback plan, and fresh spec.

Acceptance:

- A known error signature surfaces the matching card.
- Advisory includes root cause and resolution.
- User can dismiss.
- Acceptance/dismiss updates metadata.
- Ordinary task execution is not broken if guard fails.
- A dismissed advisory is suppressed for the same command/path/session key.
- Weak single-signal matches are recorded as low-confidence or withheld rather
  than shown as high-confidence warnings.
- Repeated dismissals create a Steward triage signal instead of increasing
  warning severity.
- False-positive rate is reported as `irrelevant_or_contradicted / shown`, not
  mixed with useful dismissals or user ignore events.

Suggested tests:

- Unit: matcher detects stack/keyword/file pattern.
- Unit: guard failure is non-fatal.
- Unit: weak single-signal match does not surface a high-confidence advisory.
- Unit: repeated dismissals lower card priority and emit triage metadata.
- E2E or integration: simulated command failure shows advisory.

## Phase 5: Hybrid Retrieval And Quality Metrics

Goal:

Improve retrieval quality after the product loop is proven.

Scope:

- Add chunk-level indexing or expose runtime wiki chunk metadata.
- Add embedding/rerank path if supported locally.
- Add retrieval quality dashboard:
  - unreferenced pages
  - stale cards
  - low-confidence high-hit items
  - duplicate clusters
  - source gaps
- Add evaluation fixtures for routeContext and error card matching.

Non-goals:

- No external cloud dependency as a required baseline.
- No vector DB requirement unless local install story is clear.

Acceptance:

- routeContext quality improves on fixtures.
- citations can point to page sections or passages.
- dashboard identifies stale/duplicate/source-gap items.
- fallback keyword search remains available.

## Phase 6: Promotion, Decay, And Cross-Project Reuse

Goal:

Make knowledge mature over time.

Scope:

- Promote frequently accepted cards.
- Demote stale/dismissed cards.
- Support cross-project cards with scoped applicability.
- Add review reminders for high-impact stale knowledge.

Non-goals:

- No global sharing by default.
- No leaking workspace-specific secrets.

Acceptance:

- Confidence changes based on usage.
- Stale cards are marked and excluded from default injection.
- Cross-project import/export requires user confirmation.

## Phase Gate Checklist

Every phase must answer:

- Does the current system still run through the normal Chat and Knowledge paths
  after this change?
- What user-visible workflow changed?
- Which host-api methods are touched?
- Does it preserve renderer/Main/runtime boundary?
- Can Chat still send if Knowledge fails?
- Does it create only Inbox/Draft/Proposal unless user confirms apply?
- If docs and current architecture disagree, is the drift documented with a
  compatibility path rather than resolved through a broad refactor?
- Are all strings i18n-covered?
- Is there an Electron E2E for user-visible UI?
- Is there a unit test for persistence/contract behavior?

## Recommended First Development Slice

Completed baseline slice:

- Error-experience metadata and validation helpers exist in the Knowledge API
  path.
- Librarian actions can create reviewable drafts / error-experience candidates
  and send content to Steward review.
- Inbox -> Draft -> Proposal preservation and user-confirmed apply are covered
  by the Knowledge page workflow.
- `routeContext` can feed Suggest-mode Knowledge Preflight.
- Chat can render, inspect, dismiss, and attach preflight suggestions without
  blocking ordinary send.

Next component slice:

0. Run a compatibility pass over the current Knowledge architecture and record
   drift that affects Chat, `routeContext`, Inbox, Draft/Proposal, or Steward
   review.
1. Implement Phase 2 Steward Triage for Inbox groups and duplicate/conflict
   actions.
2. Add a dedicated E2E for Librarian-created error-experience candidates.
3. Add routeContext evaluation fixtures for docs/pitfalls/rules ranking.
4. Start Phase 3 by enforcing grounded answer sections in the Librarian modal.
5. Keep Phase 4 execution-time guard advisory-only until Phase 2/3 evidence is
   stable.

The completed baseline gives a visible end-to-end loop without touching runtime
execution; the next slice should improve triage, grounding, and metrics before
any execution-time advisory guard expands the surface.
