---
lifecycleStatus: active
id: rsi-feedback-loop-pilot
title: Pre-register the feedback-weighting pilot (TF-0654)
intent: Decide, with a pre-registered paired protocol and a computable report, whether role-memory feedback should influence retrieval/retention — without changing a product default, adding provider calls, or claiming a benefit before the evidence exists.
touchedAreas:
  - harness/specs/tasks/rsi-feedback-loop-pilot.md
  - harness/specs/fixtures/rsi-feedback-loop/**
  - scripts/rsi-feedback-pilot.mjs
  - scripts/rsi-feedback-pilot.d.mts
  - tests/unit/rsi-feedback-pilot.test.ts
  - package.json
expectedUserBehavior:
  - A reader can see exactly how the feedback question will be judged before any run exists.
  - The pilot cannot self-authorise a default, a product lock or a provider call.
  - An empty feedback store yields insufficient-evidence, never a silent pass.
requiredProfiles:
  - fast
requiredRules:
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - sekb-assisted-review-boundary
  - agent-engineering-acceptance-boundary
requiredTests:
  - node scripts/rsi-feedback-pilot.mjs --check --json
  - pnpm exec vitest run tests/unit/rsi-feedback-pilot.test.ts
acceptance:
  - The protocol fixes k=3, a 20-complete-case floor, a two-sided 95% paired interval, the pair unit (caseId/repeat) and the inference unit (caseId).
  - Exactly one flag is declared, default false, with a bit-identical off-state requirement.
  - Provider calls authorised by this pilot are zero; the pilot may only read recorded feedback.
  - At least five negative controls are registered, including a safety-anchor regression and a missing-cost case.
  - The report emits insufficient-evidence when the feedback store is empty or below the floor.
docs:
  required: false
  note: The protocol and report are the reader-facing artefacts; no README change is needed because no user-visible behaviour changes.
readmeUpdates: not-required
---

# Feedback-weighting pilot contract

TF-0654 asks a narrow question: **does recorded role-memory feedback improve
retrieval/retention outcomes enough to justify wiring it into decisions?**

It is deliberately pre-registered and offline:

- The arms are `off` (today's behaviour) and `on` (feedback contributes a bounded
  weight to the retrieval score). One flag, default false, off-state must be
  bit-identical to today.
- The pilot reads recorded feedback only. `providerCallsAuthorized` is 0; a run
  that needs new model calls is out of scope and must be re-registered.
- The verdict vocabulary is the same as the RSI instrument: `promote`, `hold`,
  `eliminate`, `insufficient-evidence`. Below the 20-case floor, or with an empty
  feedback store, the answer is `insufficient-evidence` — never a pass.

## Why a contract first

The 2026-11-02 audit found `memory.feedback` lands in SQLite and is displayed,
but neither `buildContextPack` nor `evaluateRetentionCandidate` reads it. The
honest status today is "diagnostic only". Turning that into a decision needs a
pre-registered protocol, otherwise a positive-looking slice of a handful of
feedback rows would be indistinguishable from overfitting to the first few users.

## Rules this pilot inherits

- `reliability-aggregation-boundary`: k=3, 20 complete cases, explicit
  `insufficient-sample`, skips/timeouts preserved.
- `paired-ablation-boundary`: pre-registration, paired `(caseId, repeat)`,
  95% interval, zero/negative effect is a valid result.
- `sekb-assisted-review-boundary`: suggestions are mutation-free; the off state
  is authoritative until evidence exists.
- `agent-engineering-acceptance-boundary`: an agent executes the run and labels
  artefacts `driven_by: agent`; no human verdict is required or claimed.
