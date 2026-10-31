---
lifecycleStatus: active
id: rsi-tf0592-statistical-adjudication
title: Bind RSI trials to resources and rederive statistical adjudication
intent: Finish the TF-0592 statistical instrument on the sealed TF-0604 inputs, preserving unrun trials and four failure classes while making reliability, paired comparison, uncertainty, budgets and artifact readback executable.
diffBase: a96ff08923ca3ec9665de4e74e383fc9ddc70843
touchedAreas:
  - scripts/rsi-tf0592-statistical-adjudication.mjs
  - scripts/rsi-tf0592-statistical-adjudication.d.mts
  - tests/unit/rsi-tf0592-statistical-adjudication.test.ts
  - harness/specs/tasks/rsi-tf0592-statistical-adjudication.md
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
  - package.json
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
  - harness/specs/tasks/rsi-*.md
  - harness/specs/fixtures/rsi-evidence-loop/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - scripts/rsi-tf*.mjs
  - scripts/rsi-tf*.d.mts
  - scripts/lib/rsi-tf*.mjs
  - scripts/lib/rsi-tf*.d.mts
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/lib/agent-first-trials.mjs
  - scripts/lib/agent-first-trials.d.mts
  - scripts/lib/rsi-historical-task-corpus.mjs
  - scripts/lib/rsi-historical-task-corpus.d.mts
  - tests/unit/rsi-*.test.ts
  - scripts/lib/rsi-oracle-bindings.mjs
  - scripts/lib/rsi-oracle-bindings.d.mts
  - tests/unit/rsi-oracle-bindings.test.ts
  - harness/specs/fixtures/agent-first-framework/SHA256SUMS
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
ownedPaths:
  - scripts/rsi-tf0592-statistical-adjudication.mjs
  - scripts/rsi-tf0592-statistical-adjudication.d.mts
  - tests/unit/rsi-tf0592-statistical-adjudication.test.ts
  - harness/specs/tasks/rsi-tf0592-statistical-adjudication.md
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
  - package.json
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
residualPaths:
  - harness/specs/fixtures/agent-first-framework/SHA256SUMS
  - harness/specs/fixtures/agent-first-framework/calibration/deterministic/known-bad.json
  - harness/specs/fixtures/agent-first-framework/calibration/deterministic/known-good.json
  - harness/specs/fixtures/agent-first-framework/calibration/rubric/known-bad.json
  - harness/specs/fixtures/agent-first-framework/calibration/rubric/known-good.json
  - harness/specs/fixtures/agent-first-framework/credential-scan.json
  - harness/specs/fixtures/agent-first-framework/loop-credential-scan.json
  - harness/specs/fixtures/agent-first-framework/loop-development-evidence.json
  - harness/specs/fixtures/agent-first-framework/loop-record.json
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
  - harness/specs/fixtures/agent-first-framework/registry.json
  - harness/specs/fixtures/agent-first-framework/validation-report.json
  - harness/specs/fixtures/agent-first-system/SHA256SUMS
  - harness/specs/fixtures/agent-first-system/calibration.v1.json
  - harness/specs/fixtures/agent-first-system/corpus-validation.v1.json
  - harness/specs/fixtures/agent-first-system/credential-scan.json
  - harness/specs/fixtures/agent-first-system/development-evidence.v1.json
  - harness/specs/fixtures/agent-first-system/registry-extension.v1.json
  - harness/specs/fixtures/agent-first-system/tasks.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/SHA256SUMS
  - harness/specs/fixtures/agent-first-task-corpus/calibration-results.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration-samples.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/deterministic/known-bad.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/deterministic/known-good.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/deterministic/unknown.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/rubric/known-bad.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/rubric/known-good.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/rubric/unknown.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/trace/known-bad.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/trace/known-good.json
  - harness/specs/fixtures/agent-first-task-corpus/calibration/trace/unknown.json
  - harness/specs/fixtures/agent-first-task-corpus/credential-scan.json
  - harness/specs/fixtures/agent-first-task-corpus/model-calibration-attempt1.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/model-calibration.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/registry-extension.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json
  - harness/specs/fixtures/agent-first-task-corpus/validation-report.v1.json
  - harness/specs/guides/agent-first-acceptance.md
  - harness/specs/tasks/agent-first-evaluation-framework.md
  - harness/specs/tasks/agent-first-evaluation-loop.md
  - harness/specs/tasks/agent-first-task-corpus-calibration.md
  - harness/specs/tasks/agent-first-task-corpus.md
  - scripts/agent-first-corpus-check.d.mts
  - scripts/agent-first-corpus-check.mjs
  - scripts/agent-first-framework-check.d.mts
  - scripts/agent-first-framework-check.mjs
  - scripts/agent-first-loop-check.d.mts
  - scripts/agent-first-loop-check.mjs
  - scripts/lib/agent-first-evaluation-framework.d.mts
  - scripts/lib/agent-first-evaluation-framework.mjs
  - scripts/lib/agent-first-evaluation-loop.d.mts
  - scripts/lib/agent-first-evaluation-loop.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-task-corpus.d.mts
  - scripts/lib/agent-first-task-corpus.mjs
  - scripts/lib/rsi-historical-task-corpus.d.mts
  - scripts/lib/rsi-historical-task-corpus.mjs
  - scripts/rsi-historical-task-corpus.d.mts
  - scripts/rsi-historical-task-corpus.mjs
  - tests/unit/agent-first-evaluation-framework.test.ts
  - tests/unit/agent-first-evaluation-loop.test.ts
  - tests/unit/agent-first-graders.test.ts
  - tests/unit/agent-first-task-corpus.test.ts
  - tests/unit/rsi-historical-task-corpus.test.ts
  - harness/specs/tasks/rsi-tf0604-baseline-corpus.md
  - .gitignore
  - openclaw_runtime/scripts/generate-rsi-tf0605-evidence.ts
  - openclaw_runtime/src/knowledge/sekb/delta-playbook.test.ts
  - openclaw_runtime/src/knowledge/sekb/delta-playbook.ts
  - openclaw_runtime/src/knowledge/sekb/index.ts
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
requiredTests:
  - pnpm rsi:corpus:check
  - node scripts/agent-first-corpus-check.mjs
  - pnpm harness validate --spec harness/specs/tasks/agent-first-task-corpus-calibration.md
  - pnpm rsi:tf0592:check
  - pnpm exec vitest run tests/unit/rsi-tf0592-statistical-adjudication.test.ts tests/unit/rsi-tf0604-baseline.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0592-statistical-adjudication.md
  - pnpm run typecheck
  - git diff --check
acceptance:
  - The manifest binds the candidate commit/tree and source digests, sealed corpus/raw trials/policy hashes, actual runtime resources and an explicit unrun model/tool/network/seed envelope.
  - The reader independently recomputes per-task and total trial counts, pass^k and pass@k, Wilson intervals with case denominators, four failure classes, incomplete records and cost metrics from the bound raw inputs.
  - Paired comparison matches baseline and treatment by caseId/repeat, uses complete case clusters as independent inference units, preserves unmatched and excluded partial pairs, and reports insufficient-evidence below the complete-case floor.
  - Paired uncertainty and an explicitly labelled normal-approximation power design use the frozen five-percentage-point effect; degenerate variance reports unavailable interval/effect/power rather than zero required samples.
  - Budget totals preserve recorded consumption from incomplete cases; conditional completed-only averages remain separate from the total consumption per completed case.
  - Every registered negative control is rejected, including dirty source, input tamper, fabricated metrics, missing resources, dropped failures and invalid paired evidence.
  - SHA256SUMS covers every retained pack file; a fresh check verifies all bytes, the control registry, saved results and semantic recomputation.
  - Draft generation may observe a dirty candidate, but final check rejects it; final evidence may descend from the clean implementation commit only through declared derived pack files.
  - Artifacts name a concrete agent actor and keep realHuman, liveProvider, promotionReady and productLocksChanged false; the sealed reservation remains insufficient-evidence with zero completed cases.
docs:
  required: true
  files:
    - docs/README.md
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# TF-0592 statistical instrument

This work consumes the frozen TF-0604 corpus and raw-trial reservation. It does
not execute a model, generate an RSI candidate or change the promotion policy.
The source comparison starts at the completed TF-0604 commit above; its earlier
contract and corpus commits remain separate accepted inputs.

`pnpm rsi:tf0592:write` writes a draft or clean-source pack. `pnpm
rsi:tf0592:check` reads every retained file and recomputes the report. Writing
evidence cannot retrospectively make dirty source into a clean candidate.
An evidence-only descendant is accepted only when the implementation source
digests still match and its commit diff contains only this pack's declared files.

Executed trials use a fixed repeat in 1..3 and arm `baseline` or `treatment`.
Failures retain infrastructure/task/grader/agent attribution. Missing, timeout,
crash and skip records stay visible; they do not enter complete-case reliability
denominators. Duplicate or unknown trial identities fail closed. Statistical
test inputs are explicitly deterministic fixtures and never replace the sealed
not-run reservation. Real trial isolation and grader calibration belong to the
Agent-first execution prerequisites; absence of those effects remains visible.

The interval for absolute pass^k is Wilson over complete cases. The paired
interval reuses the existing paired-ablation instrument after matching
caseId/repeat and aggregating pass^k over complete case clusters. Repeats are
not counted as independent observations. Power is a labelled planning
approximation at 95% confidence and 80% target power, using observed case-pair
variance and the already frozen absolute effect. Zero variance does not establish
an interval or a zero-sample power design.
It is not a measured provider benefit or an authority to change product locks.

The exact residualPaths are the retained framework and two corpus prerequisites
already present in commits `7d687f0b4` and `da531317e`. They remain governed by
`agent-first-task-corpus-calibration.md`, whose checker and Harness validation
are required above. The original diffBase and every statistical acceptance
criterion remain unchanged. Residual declaration records separate ownership;
it does not make their evidence current or omit their validation.
