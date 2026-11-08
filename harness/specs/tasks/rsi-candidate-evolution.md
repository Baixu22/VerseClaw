---
lifecycleStatus: active
id: rsi-candidate-evolution
title: Version and screen prompt candidates from isolated training evidence
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Bind prompt candidates to parent versions and observed training attribution, screen them with frozen validation gates, and export a sealed candidate for a separate final evaluation.
diffBase: 4e2cd7f6474a9026d9a3ae484bf87cc478d409ce
touchedAreas:
  - openclaw_runtime/src/knowledge/sekb/knowledge-store.ts
  - scripts/rsi-candidate-evolution*.mjs
  - scripts/rsi-candidate-evolution*.d.mts
  - scripts/lib/rsi-candidate-evolution*.mjs
  - scripts/lib/rsi-candidate-evolution*.d.mts
  - scripts/rsi-benefit-eval.mjs
  - scripts/lib/rsi-benefit-eval.mjs
  - scripts/lib/rsi-benefit-eval.d.mts
  - tests/unit/rsi-candidate-evolution*.test.ts
  - tests/unit/rsi-benefit-eval.test.ts
  - vitest.rsi-adoption.config.ts
  - harness/specs/tasks/rsi-candidate-evolution.md
  - harness/specs/rules/rsi-candidate-evolution-boundary.md
  - harness/specs/guides/rsi-remediation-roadmap.md
  - harness/specs/fixtures/rsi-candidate-evolution/**
  - docs/dev/rsi-capability-and-boundaries.md
  - docs/generated/catalogs/tools.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - artifacts/comms/**
requiredProfiles:
  - fast
  - rsi
  - comms
requiredRules:
  - sekb-runtime-development-loop
  - sekb-hermes-default-off-boundary
  - rsi-experience-attribution-boundary
  - rsi-candidate-evolution-boundary
  - paired-ablation-boundary
  - reliability-aggregation-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - An explicitly invoked evaluator creates prompt versions from the training projection and retains their parent identity, original failures, attribution and budget.
  - Validation can reject or hold a candidate; the final held-out task content and results never enter generation or selection.
  - A candidate can be exercised in an isolated evaluation while its off state reproduces the frozen prior prompt exactly.
requiredTests:
  - node scripts/rsi-candidate-evolution-integration.mjs
  - node scripts/rsi-candidate-evolution.mjs check --input harness/specs/fixtures/rsi-candidate-evolution/closeout-20261108/export.v1.json
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-candidate-evolution.md
acceptance:
  - A frozen run binds disjoint training, validation and final held-out identities and digests, the prior candidate, evaluator-owned policy, generator limits and zero paid calls for the engineering run.
  - Generation receives only parent prompt and training trajectories with explicit case/grader bindings and versioned adoption receipts. Validation and held-out payloads are excluded from this projection.
  - At least two generated versions are linked by immutable parent id/content digest, with source snapshots, original failures, attempted budgets and selection or elimination records persisted in existing SEKB SQLite trajectories.
  - Reservations are written before generation; duplicate, interrupted, invalid or failed attempts retain their first result and cannot silently redispatch or reset budget.
  - Validation uses the existing paired-ablation instrument with k=3, twenty complete cases, 5pp improvement, positive 95% interval lower bound, at most 10% token and tool-call growth, and zero safety/negative-control regression. Negative, unknown and fixture evidence cannot authorize promotion.
  - The first qualifying generation is selected for final measurement by a rule frozen before generation; this staged choice is recorded separately from product adoption.
  - Off/on/off prompt execution returns to the exact prior bytes; candidate generation does not activate SEKB, modify its ranking, or change product defaults, evaluator permissions or code self-modification admission.
  - A separately versioned benefit-plan binding can consume a sealed staged prompt candidate and preserves existing v1/v2/v3/v4 collector and historical-candidate semantics.
  - Focused regression, real SQLite reopen/export, source review, scoped types/lint, Harness validation and sealed artifact readback pass for a committed candidate.
docs:
  required: true
  note: Describe the explicitly invoked prompt evolution, frozen splits, reservation accounting, screening decisions and final evaluation handoff.
readmeUpdates: required
---

TF-0856 implements controlled prompt evolution. Existing SEKB trajectories hold the immutable run, attempt, candidate and decision records; the production attribution ledger supplies source identities. The prior confirmed SEKB prompt remains frozen. Training and validation use fresh agent-authored engineering controls, while final evaluation identities are sealed before either generation.

The engineering driver executes two generations and reads their records from SQLite without third-party model calls. Fixture results can exercise the numerical gate and record rejection or hold. Final benefit and product adoption are decided in TF-0857/TF-0858 using a separate budgeted experiment and independent evidence.
