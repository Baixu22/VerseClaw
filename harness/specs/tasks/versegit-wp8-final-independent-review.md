---
lifecycleStatus: active
id: versegit-wp8-final-independent-review
title: WP8 - final independent review of TF-0481 planning correction and WP7 integration
scenario: versegit-validation-layer-extension
taskType: decision
intent: Obtain and retain an independent agent verdict on the historical TF-0481 final-review gap, WP7 real host vertical slice and remaining P0/P1/P2 risks before whole-goal acceptance aggregation.
touchedAreas:
  - harness/specs/tasks/versegit-wp8-final-independent-review.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
  - harness/specs/fixtures/versegit-planning-correction/wp8-final-review-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/wp8-evidence/**
  - artifacts/versegit/wp8/**
  - scripts/verify-versegit-wp8.mjs
  - tests/unit/versegit-wp8-review.test.ts
expectedUserBehavior:
  - The review is performed by an independent agent and labelled driven_by=agent with the actual reviewer model.
  - The review verifies the historical TF-0481 correction, the initial five-P1 WP7 FAIL, each corrective patch, WP7 evidence and current node dependencies rather than trusting self-reported summaries.
  - P0/P1/P2 findings, initial-review closure evidence, residuals and the exact candidate commit/tree are digest-bound.
  - The verdict can be PASS or PASS_WITH_GAPS only when P0/P1 are zero; FAIL otherwise.
  - No human verdict, GA, release, default-on or M4 authority is inferred.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/verify-versegit-wp8.mjs
  - pnpm exec vitest run tests/unit/versegit-wp8-review.test.ts
  - node scripts/validate-versegit-planning-correction.mjs
  - pnpm --dir openclaw_runtime exec tsx ../scripts/verify-versegit-wp7.mts
  - pnpm harness validate --spec harness/specs/tasks/versegit-wp8-final-independent-review.md
acceptance:
  - The stored report contains the independent reviewer model, candidate commit/tree and digest-bound input list.
  - Verdict is PASS or PASS_WITH_GAPS with p0=0 and p1=0, or FAIL with explicit blockers.
  - Historical TF-0481 FAIL/upstream-block evidence and the initial WP7 five-P1 FAIL are not rewritten or concealed.
  - WP7 host integration is reviewed as bounded agent-driven evidence, including provider-fact, event-wiring, candidate/input, receipt-authority and cleanup-evidence closure, and not upgraded to full product M3.
  - P2 residuals remain visible and the report forbids real-human, GA, release and M4 claims.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md
---

# WP8 final independent review

WP8 is a review gate, not a new implementation surface. It consumes the historical
TF-0481 correction, its known residuals, and the completed WP7 host integration
slice. A passing verdict does not rewrite the historical FAIL and does not authorize
product release or M4.

The review output is machine-readable so WP9 can aggregate it without relying on
chat prose. The primary `ccs-agentrouter/gpt-6.1-sol` reviewer may fail at the
provider boundary; a fallback independent model is allowed only when its actual
identity is recorded and the provider failure remains in the evidence. A quota or
403 response is never itself treated as a verdict.
