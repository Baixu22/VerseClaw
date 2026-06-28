# Phase 8 Lane D: Durable Fact Promotion Gate

## Scope Confirmation

- Lane: lane-d-durable-fact-promotion-gate
- Output file: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-d-durable-fact-promotion-gate.md
- Files reviewed: runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md; harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md; openclaw_runtime/src/runtime-core/memory-context.ts; openclaw_runtime/src/runtime-core/memory-store.ts; openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; openclaw_runtime/src/context-engine/memory-context-provider.ts; tests/unit/runtime-memory-context-contracts.test.ts; tests/unit/runtime-memory-store.test.ts; tests/unit/runtime-memory-proposal-shadow.test.ts; tests/unit/runtime-memory-context-provider.test.ts
- Files changed: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-d-durable-fact-promotion-gate.md
- Runtime behavior changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane D accepts the durable promotion gate evidence already present in the Phase 7 memory foundation. Candidate facts and LLM/deterministic proposals remain proposal-only unless they carry accepted verification status plus verifier, human, or deterministic-rule promotion evidence. Current-valid queries exclude invalidated, expired, rejected, candidate, and unpromoted facts by default. No completion, verifier, security, retry, tool, or runtime authority was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Accepted durable facts require accepted verification status and promotion evidence | file | openclaw_runtime/src/runtime-core/memory-context.ts | RuntimeMemoryTemporalFact at lines 201-207; isRuntimeMemoryTemporalFact at 570-583 | Candidate-like values or missing promotion evidence are rejected. |
| Promotion evidence is sanitized and must cite evidence refs | file | openclaw_runtime/src/runtime-core/memory-context.ts | sanitizeRuntimeMemoryFactPromotionEvidence at 1342-1352 | Promotion evidence is a distinct field, not source refs alone. |
| Tests reject durable facts with candidate status or empty promotion evidence | test | tests/unit/runtime-memory-context-contracts.test.ts | lines 229-236 | Direct proof that candidates cannot masquerade as durable facts. |
| Source episode refs and evidence refs are required on candidates/facts | file/test | openclaw_runtime/src/runtime-core/memory-context.ts; tests/unit/runtime-memory-context-contracts.test.ts | memory-context.ts:544-565; test lines 154-228 | Durable facts cite source episodes and evidence refs. |
| Proposal shadow emits candidates and never accepted facts | file/test | openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; tests/unit/runtime-memory-proposal-shadow.test.ts | memory-proposal-shadow.ts:102-130, 238-250; test lines 41-101, 144-188 | Result type and implementation keep acceptedFacts empty. |
| Invalidation proposals are candidate/proposal-only and do not mutate accepted facts | file/test | openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; tests/unit/runtime-memory-proposal-shadow.test.ts | proposeRuntimeMemoryInvalidations at 186-235; test lines 144-188 | Conflicts propose invalidations only. |
| Current-valid queries exclude candidate/rejected/invalidated/expired/unpromoted by default | file/test | openclaw_runtime/src/runtime-core/memory-context.ts; openclaw_runtime/src/runtime-core/memory-store.ts; tests/unit/runtime-memory-store.test.ts | memory-context.ts:900-906, 1176-1195; memory-store.ts:487-493; test lines 239-329 | Inclusion requires explicit query options. |
| Provider includes candidates only when explicitly requested | test | tests/unit/runtime-memory-context-provider.test.ts | lines 212-241 | Memory context does not expose candidates by default. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | runtime-memory-proposal-shadow.test.ts:41-69; runtime-memory-context-provider.test.ts:66-95 | pass | Proposal/provider disabled paths emit no accepted facts or behavior changes. |
| Raw chat/raw trace rejection | runtime-memory-context-contracts.test.ts:239-256; runtime-memory-proposal-shadow.test.ts:105-130 | pass | Raw summaries are rejected before candidate creation. |
| No raw retention | raw-retention scan over memory code/tests | pass | Production matches are sanitizer denylist/rejection classifier; test matches are negative fixtures. |
| No service/exporter/database/listener | focused service/exporter scan over memory production files | pass | No matches. |
| Source episode/evidence refs | memory-context.ts:544-565; runtime-memory-context-contracts.test.ts:154-228 | pass | Both are required and distinct. |
| Durable promotion gate | memory-context.ts:570-583; runtime-memory-context-contracts.test.ts:229-236 | pass | Durable fact guard is explicit. |
| Current-valid query exclusion | memory-context.ts:1176-1195; runtime-memory-store.test.ts:239-329 | pass | Candidate/rejected/invalidated/expired/unpromoted excluded unless requested. |
| Rollback proof | leave proposal/provider flags false; no code changed | pass | No Lane D runtime change to roll back. |
| Comms replay/compare if required | changed files list | not applicable | No comms paths changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Proposal requires shadow and proposeFacts flags at memory-proposal-shadow.ts:102-107. |
| No raw chat-log/raw trace memory | pass | Raw rejection tests at runtime-memory-context-contracts.test.ts:239-256 and proposal test lines 105-130. |
| No unverified durable facts | pass | Durable guard at memory-context.ts:570-583. |
| No persistence without rollback proof | not applicable | Lane D does not touch persistence. |
| No provider-ordering cutover without parity proof | not applicable | Lane D does not touch provider registration/order. |
| No runtime authority | pass | Proposal result is proposalOnly and readonly at memory-proposal-shadow.ts:123-130; provider no-authority metadata at memory-context-provider.ts:353-361. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 context | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 spec | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md | pass | Phase 7 prerequisite | none |
| rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts | pass, 5 files / 31 tests | Promotion gate, proposal-only behavior, default query exclusions | none |
| rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false | pass | Type-level guard surfaces | none |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| LLM extraction could be mistaken for durable truth | Phase 8 spec forbids unverified durable facts; proposal helper returns acceptedFacts empty | Keep LLM or automatic extraction proposal-only until verifier/human/deterministic-rule promotion evidence exists. |
| Source episode refs are useful but not verifier evidence by themselves | memory-context.ts has separate sourceEpisodeRefs, evidenceRefs, and promotion.evidenceRefs | Durable promotion must continue to require promotion evidence, not just source provenance. |

## Status

```text
Status: accepted
```
