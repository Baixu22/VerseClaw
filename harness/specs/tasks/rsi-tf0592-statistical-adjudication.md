---
lifecycleStatus: active
id: rsi-tf0592-statistical-adjudication
title: Bind RSI trials to resources and rederive statistical adjudication
intent: Finish the TF-0592 statistical instrument on the sealed TF-0604 inputs, preserving unrun trials and four failure classes while making reliability, paired comparison, uncertainty, budgets and artifact readback executable.
diffBase: 5bf8a0b253f9b195067f30e6789861d0eba48245
touchedAreas:
  - scripts/rsi-tf0592-statistical-adjudication.mjs
  - scripts/rsi-tf0592-statistical-adjudication.d.mts
  - tests/unit/rsi-tf0592-statistical-adjudication.test.ts
  - harness/specs/tasks/rsi-tf0592-statistical-adjudication.md
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
  - package.json
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
ownedPaths:
  - scripts/rsi-tf0592-statistical-adjudication.mjs
  - scripts/rsi-tf0592-statistical-adjudication.d.mts
  - tests/unit/rsi-tf0592-statistical-adjudication.test.ts
  - harness/specs/tasks/rsi-tf0592-statistical-adjudication.md
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
  - package.json
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
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
