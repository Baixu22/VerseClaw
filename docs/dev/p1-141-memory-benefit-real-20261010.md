# P1 #141 — real-model memory-benefit closure

driven_by: agent; actor: codex
Date: 2026-10-10

## What was wrong

- The only real-model memory-benefit tests were describe.skipIf(!hasDeepSeekKey()),
  so they silently skipped and produced no benefit evidence.
- The synthetic "benefit" path compared an empty DB against a precisely seeded DB
  and additionally filtered queries with ilterQueriesBySeededGroups, so it measured
  retrieval correctness, not task benefit.

## What was added

	ests/unit/runtime-memory-benefit-real-model.test.ts

- Same unfiltered question set for both arms; seededQueryFilter: false is recorded.
- Baseline arm: no memory. Treatment arm: facts read back through the real
  createRuntimeMemoryProviderResult hydration path.
- Negative control: a question the memory cannot answer, asserted to stay grounded
  (UNKNOWN) rather than hallucinating.
- Uses the repository's explicit-endpoint real-LLM client; no credential is written
  to receipts or evidence.

## Real run (StepFun)

- endpoint: https://api.stepfun.com/step_plan/v1/chat/completions
- model: step-5-preview
- result: baselineHits 0/2 (UNKNOWN, UNKNOWN); treatmentHits 2/2
  (Thursday 09:00 UTC, Morgan); controlGrounded true (UNKNOWN)
- receipts: 5 successful status: 200 responses, all eturnedModel: step-5-preview

## Evidence

- rtifacts/p1-141-memory-benefit-real-20261010/report.json
- rtifacts/p1-141-memory-benefit-real-20261010/SHA256SUMS
  (6d4720441510d46e23f933809d1791048c6da875cea895fa4bcd1adc12164993)

## Boundaries

- The fixture corpus is still synthetic (controlled_fixture); this closes the
  "no real model in the loop" gap, not the "real user data" gap.
- The test still skips when no explicit endpoint/key is configured; the difference is
  that a run now leaves verifiable, digest-bound evidence instead of silently passing.
