# KE Integration (三单合流): full-chain integration test

> Batch: integration单. Status: plan, 2026-08-13. Conflicts resolve against real code.
>
> Historical snapshot of the 2026-08-13 plan, including the deferred work recorded below. For current implementation status, see the [latest handoff](../../../docs/dev/handoffs/LATEST.md).

## Scope

One end-to-end test that composes the three P1 modules into the minimal closed loop:
candidate -> confirm -> persist -> shadow retrieval hit -> receipt. Plus the flag-off
three assertions and 100% shadow receipt coverage.

## Composition (reuse, no new production code)

- Candidate gen: `runKeCandidateGeneration` -> `proposalShadow.candidates` (verificationStatus=candidate).
- Confirm: `promoteRuntimeMemoryFactCandidate` -> human_approved fact.
- Persist: `createRuntimeMemoryRuntimeIntegration({ persist:true, database.path=temp })` -> `appendFact`
  (real SQLite via node:sqlite) -> `loadStore()` re-read.
- Shadow retrieval: `runKeRetrievalShadow` with the persisted fact as a candidate -> would_retrieve -> receipt.
- Census: `assertRuntimeMemoryOwnerConvergence`.

## Flag-off three assertions

- zero candidates (`runKeCandidateGeneration` off), zero writes (persist off -> appendFact
  "skipped", loadStore empty, zero SQLite open), zero retrieval (`runKeRetrievalShadow` off),
  census ok; prompt bytes untouched (no injection surface).

## Guard sees red first (§1.A.10)

- `assertRuntimeMemoryOwnerConvergence({ persist:true }).ok === false` (persist=true is the
  second durable authority the guard rejects).
- `appendFact` with persist=false returns `{ status:"skipped", reason:"flag_disabled" }`.

## Not done here

Error-card path (knowledge inbox) is electron-layer, covered by KE-P1-3 E2E. This test covers
the runtime fact path + shadow retrieval. The runtime<->gateway wiring of the terminal hook and
retrieval point is the remaining production call-site work (deferred, recorded).
