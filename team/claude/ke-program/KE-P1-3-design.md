# KE-P1-3 Design: Review Queue UI (minimal, confirm/reject + candidate source)

> Batch: KE-P1-3 (单B). Status: implementation plan, 2026-08-13.
> Conflicts resolve against real code (KE-P1 charter §2.10). KE-P0-2 is absent (D5).

## Scope

A minimal Review Queue panel in the Knowledge Hub that lists candidates and offers
confirm/reject. Reads the EXISTING knowledge inbox (pending) + drafts (pending review)
via the host-api — no new IPC/host-api channel (§5.3). Confirmation persists approved changes; rejection saves review state and audit entries without promoting the candidate.

## Reuse map (no new channel)

- List candidates: `knowledge.listInboxItems({ status: 'pending' })` + `knowledge.listDrafts()`.
- Confirm (knowledge/error-card): `promoteInboxItemToDraft` -> `reviewDraft({action:'approve'})`
  -> `applyReviewedChange` (existing Knowledge Hub flow, contract.ts:5138-5158).
- Reject: `dismissInboxItem` / `reviewDraft({action:'reject'})`.
- Fact candidates (proposeFacts shadow): NOT listable via host-api (transient in KE-P1-1);
  fact confirm via `memory.propose` -> appendFact is deferred to integration单 (D6).

## Panel fields (per §5.1)

source (KnowledgeInboxItem.sourceRefs), kind (type), confidence, sensitivity
(warnings/metadata), estimated token cost (bounded body-length estimate).

## Semantic honesty (§5.5)

loading / empty / unavailable (gateway down or flag off) / failed are DISTINCT states;
failure never collapses into empty.

## Flag gate (§5.4)

Panel reads the DCS writable flag `runtime-memory-candidate-generation`
(default off). Off => panel hides candidates (unavailable state), zero writes.

## Discrepancy records (real code wins)

- D5: KE-P0-2 (review queue state machine) absent -> queue semantics reconstructed from
  the existing knowledge inbox/draft flow (pending -> promoted -> approved -> applied; dismissed).
- D6: proposeFacts shadow candidates are transient (KE-P1-1 recorded diagnostics only),
  so the UI lists knowledge inbox candidates; the fact-candidate runtime->electron bridge
  is integration单 work, not this batch.

## Not done here

No new persistence, no fact appendFact wiring, no broker ranking, no injection.
