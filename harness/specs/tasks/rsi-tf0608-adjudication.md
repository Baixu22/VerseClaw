---
lifecycleStatus: active
id: rsi-tf0608-adjudication
title: Add independent agent adjudication for RSI candidates
intent: Produce a reproducible independent verdict over the TF-0599 candidate gate, TF-0606 research report and TF-0607 contamination report, requiring distinct executor and verifier actors, exact content bindings, complete held-out trials and fail-closed disagreement.
diffBase: 96aae13ec
touchedAreas:
  - harness/specs/tasks/rsi-tf0608-adjudication.md
  - scripts/rsi-tf0608-adjudication.mjs
  - scripts/rsi-tf0608-adjudication.d.mts
  - tests/unit/rsi-tf0608-adjudication.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0608/**
ownedPaths:
  - harness/specs/tasks/rsi-tf0608-adjudication.md
  - scripts/rsi-tf0608-adjudication.mjs
  - scripts/rsi-tf0608-adjudication.d.mts
  - tests/unit/rsi-tf0608-adjudication.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0608/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0608/verdict.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0608/control-results.v1.json
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-tf0608-adjudication.test.ts --maxWorkers=1
  - node scripts/rsi-tf0608-adjudication.mjs --check
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0608-adjudication.md
  - pnpm run typecheck
acceptance:
  - The adjudicator reads only registered regular-file paths from disk, verifies complete SHA256SUMS manifests for TF-0604/0599/0606/0607, and binds exact input digests before issuing a verdict.
  - TF-0599 aggregates and negative controls, TF-0606 candidate/report/controls, and TF-0607 report/controls are recomputed from their frozen inputs and compared with disk.
  - Executor and verifier identities must differ; reports authored by the same actor, stale candidate evidence, hard-coded verdicts and missing evidence fail closed.
  - The adjudicator recomputes case/trial counts, k, pass^k/pass@k, failure classes, negative controls, contamination and promotion gates; CI/cost remain null/not-run when no completed trials exist.
  - A below-floor or not-run candidate yields insufficient-evidence; it cannot yield promote even if a report contains a self-declared pass.
  - Disagreement, wrong paths, tampered reports, stale digests, fabricated CI, auto-merge, product locks, real-human or live-provider claims are rejected explicitly.
  - Artifacts record driven_by=agent and a concrete verifier actor; no product default, release or real-human claim changes.
docs:
  required: true
  files:
    - harness/specs/tasks/rsi-tf0608-adjudication.md
readmeUpdates: not-required
---

# TF-0608 independent adjudication

TF-0608 consumes only persisted candidate, evaluation and contamination evidence. It verifies exact hashes, distinct actors, held-out completeness and the pre-registered decision gate. The current candidate has zero complete trials and therefore must receive insufficient-evidence. A clean static report or a self-declared verdict cannot turn that into promotion.
