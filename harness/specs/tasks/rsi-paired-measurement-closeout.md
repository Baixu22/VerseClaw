---
lifecycleStatus: active
id: rsi-paired-measurement-closeout
title: Recompute the retained v4 campaign and verify prompt rollback
intent: Close the budget-limited RSI experiment from immutable Responses, tool, oracle and campaign receipts, then execute the existing prompt switch through off/on/off and continuation.
diffBase: fb2d09a3a401deecace0ccdcb6d9fc71da0b9693
touchedAreas:
  - scripts/rsi-paired-measurement-replay.*
  - tests/unit/rsi-paired-measurement-replay.test.ts
  - harness/specs/tasks/rsi-paired-measurement-closeout.md
  - harness/specs/fixtures/rsi-paired-measurement/**
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - rsi-public-input-boundary
  - rsi-candidate-evolution-boundary
  - rsi-campaign-budget-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - disk-temp-policy
relatedScenarios:
  - gateway-backend-communication
expectedUserBehavior:
  - A retained campaign exposes recorded, incomplete and unexecuted slots with its original resource limits and candidate identity.
  - Independent arithmetic can reproduce the reliability, paired effect, cost and safety verdict from raw receipts.
  - Turning off the evaluation prompt switch restores the previous prompt bytes and supports a fresh continuation.
requiredTests:
  - node node_modules/vitest/vitest.mjs run --config vitest.rsi.node.config.ts tests/unit/rsi-paired-measurement-replay.test.ts tests/unit/rsi-campaign-budget.test.ts tests/unit/rsi-coding-tool-loop.test.ts
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-paired-measurement-closeout.md
  - git diff --check
acceptance:
  - Read the frozen plan, source bindings, all retained Responses, tool effects, independent historical oracle records and the campaign ledger; identify missing slots separately.
  - Recompute passK, passAtK, complete case pairs and the paired interval with arithmetic separate from the frozen statistical implementation. Preserve unavailable intervals and power for zero variance.
  - Reconcile reservations, settled tokens and unknown-use upper bounds without dispatching requests; retain the original token, call and currency authorization.
  - Verify raw request continuations, declared tool paths, edit digests, final oracle bytes, input/split commitments, manifest entries and the first resource failures.
  - Apply the original 5pp improvement, positive 95 percent lower bound, 10 percent cost and safety/anchor gates. A negative or incomplete experiment retains its observed decision.
  - Exercise the existing evaluation switch with the sealed second-generation prompt through off/on/off and a fresh-process continuation; record the restored byte digest.
  - Retain raw evidence in a recoverable private archive and track a credential-scanned curated pack with exact source and artifact digests.
  - The parent improvement milestone keeps its unmet positive-effect criterion when the candidate is eliminated.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

The retained experiment is `e8866141-a1f3-43c4-8efa-dfc9822cd24d` at source
`fb2d09a3a401deecace0ccdcb6d9fc71da0b9693`. Its protocol, prompt selection,
24 task identities, three arms, k=3 and 216 declared slots stay frozen.
The original report generated before the trials is archived before final replay.

TF-0857 delivers the retained measurement and TF-0858 delivers the independent
calculation and behavior rollback. Execution and evidence can complete on the
negative branch; the TF-0851 positive-improvement requirement remains visible.
Any further model experiment needs its own explicit resource authorization.
