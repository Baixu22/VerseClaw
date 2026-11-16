---
lifecycleStatus: active
id: semantic-convergence-benefit
title: Recomputable semantic repair benefit and retirement decision
scenario: gateway-backend-communication
task_forest:
  - TF-0747
taskType: runtime-bridge
diffBase: 07f6564b0
intent: Summarize ten finding verdicts, observed after-state, historical baseline limits and measured verification cost without inventing live-user benefit.
touchedAreas:
  - scripts/semantic-convergence-benefit.mjs
  - scripts/semantic-convergence-benefit.test.mjs
  - harness/specs/tasks/semantic-convergence-benefit.md
  - docs/dev/semantic-convergence-benefit-20261104.md
  - docs/dev/evidence/semantic-convergence-20261104/tf-0747/**
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - The final report distinguishes observed local behavior, static structure, historical baselines, and unmeasured live-user impact.
requiredTests:
  - node --test scripts/semantic-convergence-benefit.test.mjs
  - node scripts/semantic-convergence-benefit.mjs --verify
  - node docs/dev/evidence/semantic-convergence-20261104/tf-0746/recompute.mjs
acceptance:
  - Every numeric result is derived from retained inputs by the report generator and verifies without rewriting historical evidence.
  - All ten finding groups have a verdict and explicit limitations; sub-requirements remain visible in the final matrix.
  - The frozen weights remain 0.35 correctness, 0.25 user impact, 0.20 coverage, 0.10 cost efficiency and 0.10 evidence quality.
  - Dimensions without a comparable measured baseline are unavailable, with a bounded score interval, never invented point estimates or performance gains.
  - decision.status is keep-retired; proposed/applied default changes are separately empty, and no product/default/release state changes.
humanEvidence: not-required
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/semantic-convergence-benefit-20261104.md
---

The original M0 baseline is source-derived and records dirty=true. Retain it
unchanged and state that boundary. Its label counts and source-shape metrics
must not be compared numerically to different behavioral oracles as if they
were paired experiments. The weighted score is a repair-evidence score for
ordering, not a percentage of live-user improvement or a release decision.
