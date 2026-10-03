# KE-P1-1 Design: task-terminal candidate generation (0-3, failure-guard first)

> Batch: KE-P1-1 (单A). Author: dev agent. Status: implementation plan, 2026-08-13.
> Parent: KE-PROGRAM.md / KE-P1 dispatch charter v1 (both absent in-tree; see discrepancy D1).
> This doc is a working plan, not a new authority. Conflicts resolve against the P0 contract and real code (KE-P1 charter §2.10).

## Scope

At task termination, generate 0-3 candidates from **real** trajectory/receipt evidence
(failure-guard first) into the Review Queue. Candidates are Envelope fact-path subsets
(verificationStatus=candidate) and error-card proposals. Nothing is auto-persisted;
promotion stays human. Flag-gated, default off.

## Hook placement

- `agent-run-terminal-outcome.ts` is pure normalization (no side effects) — NOT the hook.
- Terminal consumption lives in `tasks/task-registry.ts` (status patches) and
  `agents/task-loop-controller.ts` (TaskLoop terminal: `completeObservedRun`).
- KE-P1-1 ships a **pure, side-effect-free** candidate generator (`ke-candidate-generation.ts`)
  plus a thin terminal adapter. The generator is the tested unit; the adapter is the
  (flag-gated) terminal wiring, exercised by a wiring test. No DB access inside the generator.

## Candidate shape (Envelope fact-path subset)

Per P0 contract §9 「派单附注 R3-2」, the authoritative subset is:

```ts
type ProposedFactEnvelopeSubset = {
  envelopeId: string;
  kind: "fact";
  contentRef: string;
  sourceRefs: string[];
  evidenceDigest: string;      // sha256:... of sanitized evidence
  verificationStatus: "candidate";
  sensitivity: "normal" | "secret_adjacent" | "secret";
  validity: { validAt: number; invalidAt?: number; expiresAt?: number };
  schemaVersion: 1;
  contentVersion: string;      // sha256:... (reuse context-candidate.ts digestText)
  // activationStatus intentionally ABSENT (candidate => disabled ceiling)
};
```

Error-card proposals (`kind: "error_card"`) carry title/body/sourceRefs and
`proposalOnly: true` when they touch an L4 surface.

## Failure-guard triggers

- Repeat failure: same error signature + task type, >=2 total failures -> 1 error-card candidate.
- 1 explicit user correction -> 1 error-card candidate.
- Normal success round -> 0 candidates (this is the correct default).
- Hard cap 3 candidates/task.

Error signature is derived deterministically from terminal outcome (reason + normalized
error), NOT from model self-report. See P0 §6 outcome classification (failure = command/test
non-zero, structured tool error, rejected approval, or explicit user correction).

## Flag

- New: `runtime.memory.candidateGeneration` (default false).
  - runtime config: add to `RuntimeMemoryFeatureFlags` + `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS`
    + `resolveRuntimeMemoryFeatureFlags` + zod-schema `memory`.
  - DCS UI: add to `DCS_PROD_FLAGS` (catalog) + `DCS_WRITABLE_FLAG_SPECS` (control).
- Reused: `runtime.memory.proposeFacts` + `runtime.memory.shadow` gate the fact-shadow step
  (already enforced by `buildRuntimeMemoryFactProposalShadow`).
- Off => zero candidates, zero writes (fail-closed).

## Reuse (no new storage)

- Fact candidates -> `buildRuntimeMemoryFactProposalShadow` (proposalOnly/readonly,
  acceptedFacts: []). Promotion -> `promoteRuntimeMemoryFactCandidate` (human_approved)
  -> `appendFact` behind `assertRuntimeMemoryOwnerConvergence`.
- Error cards -> knowledge inbox/draft (`shared/host-api/contract.ts` KnowledgeInboxItem/Draft).
- No new table/ledger.

## Discrepancy records (§2.10 — real code wins)

- D1: `KE-PROGRAM.md`, `R-SERIES-DEV-AGENT-PROMPT-2026-08-13.md`, `r-series/` (STATUS,
  R3-1/R3-2 reports), `KE-P0-2`, `KE-P0-6` are absent in-tree. Proceeding from P0-1+P0-3
  contract + real code; recording, not blocking.
- D2: charter KE-P1-1 says kind `semantic_fact/error_experience/procedural_principle`;
  P0 contract Envelope kind is `fact | sekb_principle | error_card`. Use P0.
- D3: charter acceptance says `verificationStatus=human_approved` (KE-P1-3); the candidate
  status is `candidate` everywhere; accepted-fact status in real code is `human_approved`
  (memory-context.ts), while P0 §2 enum spells `human_verified`. Use real code
  (`human_approved`) for accepted facts; `candidate` for candidates.
- D4: charter lists `scope/capturedAt/confidence` in the candidate shape; P0 §9 subset omits
  them. Use the P0 §9 subset (10 fields) as authoritative.

## Not done here (KE-P1-1 only)

No injection, no effect evaluation, no broker ranking, no activation, no auto L4 change.
