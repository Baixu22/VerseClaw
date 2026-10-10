---
id: p0-memory-evaluation-integrity
title: Repair P0 LoCoMo measurement and evidence integrity
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: origin/main
intent: Resolve GitHub issues 134 through 138 in the opt-in LoCoMo evaluator without changing product runtime defaults, rewriting historical evidence, or claiming model scores prove production readiness.
ownedPaths:
  - tests/unit/helpers/locomo-embedding-provider.ts
  - tests/unit/helpers/runtime-memory-context-recall.ts
  - tests/unit/helpers/locomo-pipeline.ts
  - tests/unit/helpers/locomo-report-comparator.ts
  - tests/unit/helpers/runtime-memory-locomo-report-schema.ts
  - tests/unit/helpers/runtime-memory-real-llm-client.ts
  - tests/unit/helpers/runtime-memory-judge-freeze.ts
  - tests/unit/runtime-memory-locomo-full-500.test.ts
touchedAreas:
  - tests/unit/**
  - tests/fixtures/runtime-memory-eval/**
  - scripts/check-locomo-evidence.mjs
  - scripts/check-locomo-evidence.d.mts
  - scripts/run-locomo-full-evaluation.mjs
  - artifacts/p0-memory-integrity-20261009/**
  - scripts/repository-artifacts.json
  - docs/dev/p0-memory-evaluation-integrity.md
  - harness/specs/tasks/p0-memory-evaluation-integrity.md
  - harness/specs/rules/locomo-evaluation-integrity.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - .gitignore
  - package.json
expectedUserBehavior:
  - LoCoMo evidence IDs are resolved to actual turns; empty or unresolved gold evidence cannot create a perfect recall score.
  - Reports disclose L0/L1/L2 counts and rates, all-question metrics and an explicitly selection-biased L0+L1 subset, and do not attribute L2 full-conversation answers to retrieved memory.
  - Category retrieval regressions, especially temporal, cannot be hidden by an improved judge score.
  - External published scores are references only and are never represented as judge-comparable rankings.
  - Historical fixtures without verifiable provenance are not measured baselines. Fresh reports include all question results, source and dataset digests, judge configuration, model request usage and agent attribution.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - locomo-evaluation-integrity
forbiddenPatterns:
  - changing runtime memory defaults, product locks, judge tolerances, or product cutover status
  - committing credentials, raw authentication headers, or user runtime databases
  - relabelling synthetic or unverifiable historical numbers as a real run
  - changing Git refs or deleting historical objects to hide corruption
requiredTests:
  - pnpm exec vitest run tests/unit/context-recall.test.ts tests/unit/locomo-pipeline.test.ts tests/unit/locomo-report-comparator.test.ts tests/unit/runtime-memory-locomo-report-schema.test.ts tests/unit/locomo-evidence-integrity.test.ts tests/unit/runtime-memory-real-llm-client.test.ts tests/unit/locomo-eval-config.test.ts tests/unit/locomo-judge-registry.test.ts tests/unit/locomo-embedding-provider.test.ts
  - pnpm run typecheck:test
  - pnpm eval:runtime-memory:locomo:verify
riskNotes:
  - Real model evaluation is opt-in, agent-driven and uses the owner-provided resource; it is separate from deterministic unit tests and CI never silently treats a skip as a measured run.
  - Explicit local Qwen3 GGUF embeddings require pinned weight verification, a loopback-only endpoint, exact response identity and independent cache identity. Quantization/deployment are recorded; this is not a historical hosted-score reproduction.
  - A new model or retrieval configuration establishes a new reference only; it cannot reproduce or validate the unproven historical 0.752 or 0.452 claims.
  - Git issue 62 is diagnosed separately using immutable logs and non-destructive object recovery; unavailable objects remain an explicit gap unless the owner authorizes retiring corrupt refs.
docs:
  required: true
  reason: The full500 developer command now guarantees the full sample and fails on missing resources/evidence; all four README locales and the detailed repair record document this interface change.
acceptance:
  - Fixture-shaped turn IDs exercise context recall and L2 partition regressions in deterministic tests.
  - A J-score increase with a temporal retrieval drop is reported as a retrieval regression.
  - Final model evidence passes schema, per-question recomputation, completeness, source-freshness and digest checks; failure, skip or missing evidence is not a pass.
  - Each question binds to a unique live judge receipt whose request fingerprint and verdict match the retained question and score; a fresh full run cannot substitute cached judges or silently alter the frozen prompt.
  - Read all final artifacts from disk, run scoped tests and type checks, and commit only this isolated repair set.
---

# Scope

These are evaluator and evidence repairs, not a Runtime Memory feature graduation.
The model resource is explicitly authorized by the owner. All automation is labelled
`driven_by: agent`; no real-human participation or verdict is claimed.
