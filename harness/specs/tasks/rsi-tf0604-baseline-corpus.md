---
lifecycleStatus: active
id: rsi-tf0604-baseline-corpus
title: Build the RSI TF-0604 historical baseline corpus and negative controls
intent: Seal a reproducible, agent-driven 20+ case task corpus from committed repository acceptance records, reserve the baseline trial shape without fabricating model results, and provide fail-closed negative controls and separate failure-class aggregation for later RSI gates.
diffBase: a96ff08923ca3ec9665de4e74e383fc9ddc70843
touchedAreas:
  - scripts/rsi-tf0604-baseline.mjs
  - scripts/rsi-tf0604-baseline.d.mts
  - package.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0604/**
  - harness/specs/tasks/rsi-tf0604-baseline-corpus.md
  - tests/unit/rsi-tf0604-baseline.test.ts
  - scripts/rsi-tf0604-historical-runner.mjs
  - scripts/rsi-tf0604-system-run.mjs
  - scripts/lib/rsi-tf0604-system-run.mjs
  - scripts/lib/rsi-tf0604-system-run.d.mts
  - harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run/**
  - scripts/rsi-tf0604-historical-runner.d.mts
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/lib/agent-first-trials.mjs
  - scripts/lib/agent-first-trials.d.mts
  - scripts/lib/rsi-historical-task-corpus.mjs
  - scripts/lib/rsi-historical-task-corpus.d.mts
  - harness/specs/fixtures/agent-first-task-corpus/SHA256SUMS
  - harness/specs/fixtures/agent-first-task-corpus/registry-extension.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration-samples.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/deterministic/**
  - harness/specs/fixtures/rsi-evidence-loop/capability-evidence.d.ts
  - harness/specs/fixtures/rsi-evidence-loop/capability-evidence.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0599/**
  - harness/specs/fixtures/rsi-evidence-loop/tf0605/**
  - harness/specs/fixtures/rsi-evidence-loop/tf0606/**
  - harness/specs/fixtures/rsi-evidence-loop/tf0607/**
  - harness/specs/fixtures/rsi-evidence-loop/tf0608/**
  - harness/specs/fixtures/rsi-evidence-loop/tf0609/**
  - harness/specs/tasks/rsi-tf0599-candidate-gate.md
  - harness/specs/tasks/rsi-tf0605-delta-playbook.md
  - harness/specs/tasks/rsi-tf0606-self-harness.md
  - harness/specs/tasks/rsi-tf0607-contamination-gate.md
  - harness/specs/tasks/rsi-tf0608-adjudication.md
  - harness/specs/tasks/rsi-tf0609-code-self-modification.md
  - harness/specs/tasks/rsi-tf0610-evidence-closeout.md
  - docs/dev/rsi-capability-and-boundaries.md
  - openclaw_runtime/scripts/generate-rsi-tf0605-evidence.ts
  - openclaw_runtime/src/knowledge/sekb/**
  - scripts/rsi-tf0599-candidate-gate.mjs
  - scripts/rsi-tf0599-candidate-gate.d.mts
  - scripts/rsi-tf0606-self-harness.mjs
  - scripts/rsi-tf0606-self-harness.d.mts
  - scripts/rsi-tf0607-contamination-gate.mjs
  - scripts/rsi-tf0607-contamination-gate.d.mts
  - scripts/rsi-tf0608-adjudication.mjs
  - scripts/rsi-tf0608-adjudication.d.mts
  - scripts/rsi-tf0609-code-self-modification.mjs
  - scripts/rsi-tf0609-code-self-modification.d.mts
  - scripts/rsi-tf0610-capability-report.mjs
  - scripts/rsi-tf0610-capability-report.d.mts
  - tests/unit/rsi-tf0599-candidate-gate.test.ts
  - tests/unit/rsi-tf0606-self-harness.test.ts
  - tests/unit/rsi-tf0607-contamination-gate.test.ts
  - tests/unit/rsi-tf0608-adjudication.test.ts
  - tests/unit/rsi-tf0609-code-self-modification.test.ts
  - tests/unit/rsi-tf0610-capability-report.test.ts
  - harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/validation-report.v1.json
  - tests/unit/rsi-tf0604-historical-runner.test.ts
  - docs/README.md
  - scripts/repository-artifacts.json
  - .gitignore
ownedPaths:
  - scripts/rsi-tf0604-baseline.mjs
  - scripts/rsi-tf0604-baseline.d.mts
  - package.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0604/**
  - harness/specs/tasks/rsi-tf0604-baseline-corpus.md
  - tests/unit/rsi-tf0604-baseline.test.ts
  - docs/README.md
  - scripts/repository-artifacts.json
  - .gitignore
residualPaths:
  - harness/specs/fixtures/agent-first-task-corpus/SHA256SUMS
  - harness/specs/fixtures/agent-first-task-corpus/registry-extension.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/validation-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/resource-fingerprint.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/statistical-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/validation-report.v1.json
  - harness/specs/tasks/agent-first-task-corpus-calibration.md
  - harness/specs/tasks/rsi-tf0592-statistical-adjudication.md
  - scripts/rsi-tf0592-statistical-adjudication.d.mts
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - reliability-aggregation-boundary
  - agent-engineering-acceptance-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm rsi:tf0604:check
  - pnpm exec vitest run tests/unit/rsi-tf0604-baseline.test.ts
  - pnpm exec vitest run tests/unit/rsi-tf0604-historical-runner.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0604-baseline-corpus.md
  - pnpm run typecheck
acceptance:
  - The sealed corpus contains at least 20 distinct task cases sourced from committed repository acceptance records, and every case retains source path, source digest, task input and reference outcome.
  - Every automated artifact is labelled driven_by: agent with a concrete actor; realHuman, liveProvider and promotionReady remain false.
  - Raw baseline trials are explicitly not-run and preserve one record for every corpus case; no pass^k/pass@k metric is exposed before 20 complete cases with k=3.
  - Failure classes are exactly infrastructure, task, grader and agent, and no unknown class is accepted.
  - All eight negative controls fail closed: count floor, duplicate ids, source tamper, missing source, real-human claim, unknown failure class, negative-anchor pass and insufficient-evidence bypass.
  - SHA256SUMS covers the complete TF-0604 pack, and a fresh check re-reads the files from disk.
  - No product default, lock, approval semantic, liveReady state or user-visible behavior changes.
docs:
  required: true
  files:
    - docs/README.md
---

# TF-0604 baseline corpus contract

TF-0604 is the bridge between the frozen RSI contract and later candidate evaluation. It does not implement RSI and it does not claim a quality result. It seals the task inputs and the evidence shape that later runs must consume.

The source cohort is intentionally repository-grounded: 24 committed historical acceptance records from the harness-gap closure lane (E01/E02, G01-G03, L01-L06, S01-S07 and A01-A06). These are agent-driven engineering records, not real-human traffic and not live-provider quality trials.

The pack contains:

- `task-corpus.v1.json`: 24 distinct cases, source refs/digests, task inputs, reference outcomes and forbidden-claim notes.
- `raw-trials.v1.json`: one reserved, explicitly `not-run` trial record per case; no model result is invented.
- `aggregate.v1.json`: `insufficient-evidence`, zero complete cases, no pass^k/pass@k, and four separate failure-class buckets.
- `negative-controls.v1.json` and `negative-control-results.v1.json`: integrity and gate-honesty mutations, all expected to be rejected.
- `validation-report.v1.json` and `SHA256SUMS`: the durable readback report and canonical hashes.

The later baseline runner may replace only the raw trial and aggregate evidence through a separately reviewed change. It may not change the frozen task definitions, source digests, negative controls, k=3, minimum complete-case floor of 20, or the agent-driven evidence boundary.

No human step is required. Any later human-shaped review is represented by an automated agent-driven path and labelled accordingly.

## Real system trials

`scripts/rsi-tf0604-historical-runner.mjs` executes the sealed corpus as real isolated trials:
24 cases x {baseline, treatment} x k=3 = 144 trials, each in a fresh `git archive` of the task's
own `baseCommit`. Arm separation is exact: the baseline snapshot contains only `.rsi/TASK.json`
and `.rsi/RESULT_SCHEMA.json`, while the treatment snapshot additionally carries the TF-0606
candidate prompt in `.rsi/AGENT_INSTRUCTIONS.md`, injected via the documented project-doc
fallback filename. The agent never sees the hidden oracle; graders restore frozen tests into a
separate copy and run them there.

Results are sealed per trial (`historical-result.json` plus grader execution receipts) and
preserved with `scripts/rsi-tf0604-system-run.mjs` into
`harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run`. `validateTrialPack` re-reads that
pack from disk and recomputes every seal; tampered payloads and unclassified failures are
rejected. Failure classes stay separated: `infrastructure` for envelope timeouts or environment
errors, `agent` for subject-level failures, `task` for infeasible snapshots, `grader` for
insufficient grader evidence.

As long as fewer than 20 cases complete at k=3, the aggregate and capability report stay
`insufficient-evidence` and expose no `pass^k`, `pass@k` or paired interval.
