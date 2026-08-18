# Open Questions Registry

This registry tracks open questions (OQs) for the Round 2 design (A1-A6).
Each OQ has an ID, area, question, current assumption, owner, and blocking status.
Blocking OQs must be resolved before the area's pilot gate can be promoted.

**Status**: Stage 4 deliverable. Updated as questions are resolved or new ones emerge.

---

## OQ-001: A1 — `IsolationFailureRecovery` fallback trigger conditions

- **Area**: A1 (Layered Execution Isolation)
- **Question**: Under what exact conditions does the legacy `IsolationFailureRecovery` fallback trigger, and what is the recovery semantics contract?
- **Current Assumption**: Fallback triggers when (a) shadow isolation throws, (b) timeout exceeded, or (c) kill switch active. Recovery semantics: log + revert to legacy.
- **Owner**: A1 area lead
- **Blocking**: No (shadow mode tolerates ambiguity; resolved before pilot promotion)

## OQ-002: A2 — Wave deferral vs re-plan distinction

- **Area**: A2 (Multi-Agent Orchestration)
- **Question**: When the scheduler disagrees with the shadow prediction, is that a "deferral" (wave pushed to later) or a "re-plan" (wave restructured)?
- **Current Assumption**: Deferral = same task set, later wave. Re-plan = different task set. Both increment disagreement counter; only re-plan triggers immutability check.
- **Owner**: A2 area lead
- **Blocking**: Yes (affects A5 wave immutability semantics)

## OQ-003: A3 — `anomalyPattern` null vs undefined semantics

- **Area**: A3 (Runtime Resilience)
- **Question**: Does `anomalyPattern: null` mean "no anomaly detected" or "classifier ran but inconclusive"? And `undefined` means "classifier did not run"?
- **Current Assumption**: `null` = classifier ran, no anomaly. `undefined` = classifier not run (flag off). Mission reviewer treats both as "no anomaly".
- **Owner**: A3 area lead
- **Blocking**: No (current behavior is well-defined; question is about documentation)

## OQ-004: A4 — Decision quality audit cadence

- **Area**: A4 (Decision Quality)
- **Question**: Should A4 audit every decision or sample? If sample, what rate?
- **Current Assumption**: Shadow mode audits every decision (sampling rate = 1.0). Post-promotion: sample at 10% unless severity flag set.
- **Owner**: A4 area lead
- **Blocking**: No (shadow mode is full-audit; sampling is a post-promotion concern)

## OQ-005: A5 — Budget plan adoption: opt-in or opt-out

- **Area**: A5 (Adaptive Context Budget)
- **Question**: When the compression planner receives an A5 plan, is adoption the default (opt-out) or optional (opt-in)?
- **Current Assumption**: Default-adopt (opt-out). Planner must explicitly record `planIgnored` with a reason.
- **Owner**: A5 area lead
- **Blocking**: Yes (affects A5 graduation metric: adoption rate)

## OQ-006: A6 — `ResumeContractVerifier` failure recovery

- **Area**: A6 (Long-Running Persistence)
- **Question**: When `ResumeContractVerifier` fails, what is the recovery path? Full re-verification, or targeted re-verification of only the failed tools?
- **Current Assumption**: Full re-verification (conservative). Targeted re-verification is a Stage 5 optimization.
- **Owner**: A6 area lead
- **Blocking**: No (Stage 4 ships full re-verification; targeted is future work)

## OQ-007: Cross-area — Decision precedence in conflict scenarios

- **Area**: Cross-area (A1-A6)
- **Question**: When A6 (resume) and A1 (lease) conflict during mid-turn pause, which commits first? The composition spec says A6 > A1, but what if A6 checkpoint write fails?
- **Current Assumption**: A1 lease commits first (always). A6 checkpoint write is best-effort after lease commit. If A6 fails, A1 lease still holds (no rollback).
- **Owner**: Architecture lead
- **Blocking**: Yes (affects Blocker 4 resolution correctness)

## OQ-008: A1 — `dynamic_writes` tools and undeclared-write detection

- **Area**: A1
- **Question**: Should `dynamic_writes` tools be entirely excluded from undeclared-write detection, or should there be a heuristic (e.g., path prefix allow-list)?
- **Current Assumption**: Entirely excluded. `dynamic_writes` tools declared their behavior; verifying arbitrary paths is out of scope for shadow measurement.
- **Owner**: A1 area lead
- **Blocking**: No (current behavior is documented; question is about future enhancement)

## OQ-009: A6 — Volatile vs guaranteed checkpoint classification

- **Area**: A6
- **Question**: How is a checkpoint classified as "volatile" vs "guaranteed"? Is it a flag on the checkpoint write, or inferred from the resume contract?
- **Current Assumption**: Explicit flag on the checkpoint write (`volatile: true`). Mislabeled volatile-as-guaranteed is a critical violation.
- **Owner**: A6 area lead
- **Blocking**: Yes (affects A6 graduation gate: `volatileMislabelCount` must be 0)

## OQ-010: A2 — Multi-worker resume: new sessions vs reconnect

- **Area**: A2
- **Question**: On mid-checkpoint multi-worker resume, should new child sessions be created, or should the old sessions be reconnected?
- **Current Assumption**: New child sessions (no reconnect). Reconnect is a Stage 5 optimization that requires session migration support.
- **Owner**: A2 area lead
- **Blocking**: No (Stage 4 ships new-sessions-only; reconnect is future work)

## OQ-011: Cross-area — Shadow total memory budget allocation

- **Area**: Cross-area
- **Question**: How is the 24MB shadow memory budget allocated across A1/A2/A5/A6?
- **Current Assumption**: Equal split (6MB each) with overflow going to the area with the highest drop priority (A6 first, then A1).
- **Owner**: Architecture lead
- **Blocking**: No (Stage 4 measures total; per-area allocation is a Stage 5 concern)

## OQ-012: A5 — Per-turn cumulative latency degradation order

- **Area**: A5
- **Question**: The degradation order is A4→A3→A5→A1. But what if A4 is not active (no audit)? Does the order shift, or does A4's slot stay reserved?
- **Current Assumption**: Order shifts: A3→A5→A1 when A4 inactive. A4's slot is not reserved.
- **Owner**: A5 area lead
- **Blocking**: No (Stage 4 ships the fixed order; dynamic shifting is a Stage 5 concern)
