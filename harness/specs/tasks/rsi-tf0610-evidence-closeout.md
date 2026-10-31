---
lifecycleStatus: active
id: rsi-tf0610-evidence-closeout
title: Publish the final RSI capability and evidence report
intent: Consolidate the implemented RSI gates, sealed evidence, independent checks, untested boundaries and residual owners into one machine-readable capability report and a reader-facing boundary document. Preserve honest insufficient-evidence and No-Go conclusions while linking the report to Task Forest.
diffBase: 9a7cace95
touchedAreas:
  - harness/specs/tasks/rsi-tf0610-evidence-closeout.md
  - scripts/rsi-tf0610-capability-report.mjs
  - scripts/rsi-tf0610-capability-report.d.mts
  - harness/specs/fixtures/rsi-evidence-loop/capability-evidence.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/capability-evidence.d.ts
  - tests/unit/rsi-tf0610-capability-report.test.ts
  - docs/dev/rsi-capability-and-boundaries.md
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
  - scripts/lib/rsi-oracle-bindings.mjs
  - scripts/lib/rsi-oracle-bindings.d.mts
  - tests/unit/rsi-oracle-bindings.test.ts
  - harness/specs/fixtures/agent-first-framework/SHA256SUMS
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
  - scripts/lib/rsi-trial-scratch.mjs
  - scripts/lib/rsi-trial-scratch.d.mts
ownedPaths:
  - harness/specs/tasks/rsi-tf0610-evidence-closeout.md
  - scripts/rsi-tf0610-capability-report.mjs
  - scripts/rsi-tf0610-capability-report.d.mts
  - harness/specs/fixtures/rsi-evidence-loop/capability-evidence.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/capability-evidence.d.ts
  - tests/unit/rsi-tf0610-capability-report.test.ts
  - docs/dev/rsi-capability-and-boundaries.md
residualPaths:
  - .gitignore
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - node scripts/rsi-tf0610-capability-report.mjs --check
  - pnpm exec vitest run tests/unit/rsi-tf0610-capability-report.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0610-evidence-closeout.md
  - pnpm run typecheck
acceptance:
  - The report recomputes all upstream summaries from registered regular files and fails closed when source evidence or checks disagree.
  - The final report distinguishes implemented gates from verified capability, runtime behavior, distribution and RSI benefit.
  - Zero complete TF-0604 trials, null held-out digest and the TF-0609 No-Go remain explicit; the script-provider 24-case trial summary cannot be represented as a model-quality or RSI gain.
  - Every unresolved item has a code, concrete agent owner and review trigger; no calendar date is fabricated for unavailable system trials.
  - Product defaults, locks, approval semantics, liveReady, release state and human/live-provider claims remain false.
  - The reader-facing capability document and the machine-readable report agree, and Task Forest receives the evidence separately after a clean commit.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# TF-0610 final RSI evidence closeout

TF-0610 publishes the final engineering evidence boundary for the RSI track. It is a reporting layer: it consumes the frozen capability matrix, promotion policy, baseline, candidate gate, SEKB delta candidate, Self-Harness report, contamination gate, independent adjudication, code-self-modification eligibility decision and the Agent-first script-provider trial summary.

The implementation gates are real and testable, but they have not produced evidence that ClawX improves itself. The historical baseline has zero complete system cases, the held-out digest is unavailable, the independent adjudicator returns `insufficient-evidence/not-promote`, behavioral rollback remains untested, and TF-0609 correctly returns No-Go without generating or executing a code candidate. The 144 script-provider trials establish execution and aggregation mechanics only; both arms replay the same candidate.

The report therefore separates:

- engineering closure: the gate implementations and their tests;
- capability state: what exists in product and runtime paths;
- evidence decision: what quality or benefit the trials authorize;
- residual triggers: what must change before a later gate can re-evaluate.

No operator or repository owner has to answer a task-level question. Every residual is owned by a concrete agent role and reruns when its evidence trigger is met. Task Forest itself remains the status source; this report does not duplicate its lifecycle state.