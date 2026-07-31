---
id: c1-gate-corpus-authority
title: C1 Gate Corpus Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: C1 has one evidence-ranked gate authority

## R1: Execution fidelity outranks synthetic scale

The C1 gate authority must be the hand-authored fixture corpus whose on-arm
executes the real context view tools. A larger corpus produced by simulated arm
results may be reported as scale or routing evidence, but it cannot supersede
the real-tool corpus or authorize a product decision.

## R2: One formula and one authoritative value

All C1 reduction artifacts must use `mean(offArm toolCalls) / mean(onArm
toolCalls)` (ratio of means). The generated FP-P4-05 decision must expose
exactly one authoritative reduction factor. Other values must be explicitly
classified as reference-only.

## R3: Historical evidence is immutable in meaning

The hand-authored `4.5x` and synthetic `5.125x` results must remain present with
their corpus identity, fixture count, formula, and `live=false` marker. A
generator rerun must reproduce those definitions rather than relying on later
manual JSON edits.

## R4: Below-threshold evidence stays below threshold

The metric threshold remains `5x`. An authoritative result below that threshold
must remain `meetsGate=false` and `recommendation=keep-off`. Selecting a corpus
because it crosses the threshold is forbidden.

## R5: Synthetic evidence never becomes live evidence

Synthetic metrics must keep `live=false` and cannot set `liveReady`,
`productApproved`, `defaultOn`, or a default-on recommendation. Missing or
inconsistent authority fields fail closed.

## R6: Product locks do not move

`FP-P4-05` must leave `liveReady=false`, `productApproved=false`,
`defaultOn=false`, and context view-tools default-off. It is not evidence for
TF-0006 unblocking or joint-system GA.

## Validation

- `pnpm run dcs:c1:gate`
- `pnpm exec vitest run tests/unit/c1-authoritative-decision.test.ts tests/unit/dcs-ops-canary-hard-veto.test.ts`
- `pnpm harness validate --spec harness/specs/tasks/unified-c1-gate-corpus.md --since HEAD`
- `git diff --check`
