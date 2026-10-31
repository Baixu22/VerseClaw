---
lifecycleStatus: active
id: rsi-tf0599-candidate-gate
title: Establish the executable RSI candidate evaluation gate
intent: Turn the existing Agent-first trial, statistical, held-out and promotion contracts into a single fail-closed RSI candidate gate over the sealed TF-0604 corpus, so later candidate research cannot begin from an unbound task set, missing trials, self-review, incomplete statistics or an unrun baseline.
diffBase: 1b453b55f
touchedAreas:
  - harness/specs/tasks/rsi-tf0599-candidate-gate.md
  - scripts/rsi-tf0599-candidate-gate.mjs
  - tests/unit/rsi-tf0599-candidate-gate.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0599/**
  - harness/specs/tasks/rsi-tf*.md
  - harness/specs/fixtures/rsi-evidence-loop/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/lib/agent-first-trials.mjs
  - scripts/lib/agent-first-trials.d.mts
  - scripts/lib/rsi-historical-task-corpus.mjs
  - scripts/lib/rsi-historical-task-corpus.d.mts
  - scripts/lib/rsi-tf0604-system-run.mjs
  - scripts/lib/rsi-tf0604-system-run.d.mts
  - scripts/rsi-tf0604-historical-runner.mjs
  - scripts/rsi-tf0604-historical-runner.d.mts
  - scripts/rsi-tf0604-system-run.mjs
  - tests/unit/rsi-tf0604-historical-runner.test.ts
  - tests/unit/rsi-tf0604-system-run.test.ts
  - harness/specs/tasks/rsi-*.md
  - scripts/rsi-tf*.mjs
  - scripts/rsi-tf*.d.mts
  - scripts/lib/rsi-tf*.mjs
  - scripts/lib/rsi-tf*.d.mts
  - tests/unit/rsi-*.test.ts
  - docs/dev/rsi-capability-and-boundaries.md
  - scripts/lib/rsi-oracle-bindings.mjs
  - scripts/lib/rsi-oracle-bindings.d.mts
  - tests/unit/rsi-oracle-bindings.test.ts
  - harness/specs/fixtures/agent-first-framework/SHA256SUMS
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
  - scripts/lib/rsi-trial-scratch.mjs
  - scripts/lib/rsi-trial-scratch.d.mts
ownedPaths:
  - scripts/rsi-tf0599-candidate-gate.d.mts
  - harness/specs/tasks/rsi-tf0599-candidate-gate.md
  - scripts/rsi-tf0599-candidate-gate.mjs
  - tests/unit/rsi-tf0599-candidate-gate.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0599/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0599/gate-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0599/control-results.v1.json
residualPaths:
  - .gitignore
requiredProfiles:
  - fast
requiredRules:
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - agent-engineering-acceptance-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-tf0599-candidate-gate.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0599-candidate-gate.md
  - pnpm run typecheck
acceptance:
  - The gate reads the sealed TF-0604 task corpus and raw reservation from disk and binds their exact digests instead of trusting caller summaries.
  - A candidate envelope must name the same 24-task suite, the sealed 12-public/12-held-out split, k=3, a minimum of 20 complete cases, fixed model/tool/resource/network/seed settings and a concrete self-improvement author.
  - Baseline and candidate trials are paired by caseId and repeat, missing/incomplete trials remain visible, and pass^k, pass@k, Wilson intervals, four failure classes and cost ceilings are independently recomputed.
  - The candidate decision remains not-run or insufficient-evidence while the sealed raw-trial reservation contains zero completed cases; a caller cannot promote by supplying a pass verdict, fabricated totals or a changed held-out digest.
  - Deterministic negative controls reject count-floor bypass, source/input tamper, incomplete or duplicate trials, fake baseline improvement, self-verifier, cost overrun, safety regression, stale suite/held-out/candidate digest and unknown failure class.
  - Every report names driven_by=agent with a concrete actor, records realHuman, liveProvider and promotionReady false unless separately proven, and does not change product defaults, locks or release state.
docs:
  required: true
  files:
    - harness/specs/tasks/rsi-tf0599-candidate-gate.md
readmeUpdates: not-required
---

# TF-0599 candidate evaluation gate

TF-0599 is the stage-1 bridge between the sealed TF-0604 corpus and any
self-harness candidate. It consumes the corpus, raw trial reservation and
promotion policy from disk, binds their content, and emits either a fully
measured candidate comparison or an explicit insufficient-evidence result.

The current raw reservation has zero completed trials. The gate therefore
records not-run in its gate report. It may validate candidate envelopes and
replay deterministic contract fixtures, but no fixture is upgraded to baseline
or benefit evidence. A later runner replaces only raw trials and the gate
report through a separately reviewed evidence descendant.

Candidate code is outside the evaluator boundary. The held-out split, task
inputs, grader implementation and promotion policy are read-only inputs. A
candidate may produce a prompt, AGENTS, skill, tool-policy, SEKB playbook or
harness diff, but it cannot author or edit this gate.
