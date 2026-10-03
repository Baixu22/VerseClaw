# KE-P1-2 Design: shadow retrieval would_retrieve -> receipt

> Batch: KE-P1-2 (单C). Status: implementation plan, 2026-08-13.
> Conflicts resolve against real code (KE-P1 charter §2.10). KE-P0-6 is absent (D8).

## Scope

At the retrieval point, run a broker-v1 shadow that records `would_retrieve`
(candidate id + rank + calibratedScore/packingScore + explanation) into a
`shadow_context` receipt + a `retrieved_at` event. Zero model-input injection.

## Broker v1 (reconstructed, KE-P0-6 absent -> D8)

- `KeBrokerSignal` = { name, score 0..1, sourceRef }.
- 5 signals: lexical (token overlap), tags, error_signature, temporal (recency), quality (criticality+pinned).
- `calibratedScore` = normalized weighted sum of signals (0..1).
- `packingScore` = 1 - (tokens / budget) clipped 0..1 (how well the candidate packs).
- `KeWouldRetrieve` = { envelopeId, rank, calibratedScore, packingScore, explanation, signals, contentVersion, selectedForPresentation:false }.

## retrieved_at event (KE-P0-3 §6)

LearningAttributionCommon (arm="shadow") + { queryDigest, rank, score, retrievalReason, candidateSetDigest, selectedForPresentation:false }.

## Receipt

shadow_context kind via buildContextReceiptInput -> receipt-store (runtime_receipts),
digest/refs/counts only, no raw body. Reuses the existing receipt authority (no new table).

## Flag

`runtime.coding.sekb.retrievalShadow` (shadow-only, default off), registered in
DCS_PROD_FLAGS + DCS_WRITABLE_FLAG_SPECS (mirroring sekb-experience-shadow).

## Discrepancy records

- D8: KE-P0-6 (retrieval-broker-ranking) absent -> broker v1 reconstructed from the
  charter KE-P1-2 §1 + P0 §9 (KE-P3 returns envelopeId/score rationale/contentVersion)
  + existing SEKB lexical/metadata scoring (retrieval-engine.ts:111-137).
- D9: KE-P0-3 §6 marks retrieved_at as P4 event-log work; KE-P1-2 records it into a
  receipt (not the runtime_task_event_log), which is the KE-P1-2 acceptance surface.

## Not done here

No injection, no weight tuning (KE-P3-2), no learned ranker, no effect evaluation.
