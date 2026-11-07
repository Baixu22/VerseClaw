---
lifecycleStatus: active
id: rsi-public-task-inputs
title: Freeze public API contracts and complete RSI coding task inputs
intent: Add versioned public task declarations and historical context provenance so coding subjects can implement the declared interfaces while hidden oracles and legacy requests remain frozen.
diffBase: 5ad905b44c2822caf6037df9278a8a260a27d3f9
touchedAreas:
  - scripts/lib/rsi-task-inputs.mjs
  - scripts/lib/rsi-task-inputs.d.mts
  - scripts/rsi-task-inputs.mjs
  - scripts/lib/rsi-benefit-eval.mjs
  - scripts/lib/rsi-benefit-eval.d.mts
  - scripts/lib/rsi-coding-protocol.mjs
  - scripts/lib/rsi-coding-protocol.d.mts
  - tests/unit/rsi-task-inputs.test.ts
  - tests/unit/rsi-coding-collector.test.ts
  - harness/specs/fixtures/rsi-task-inputs/**
  - harness/specs/fixtures/rsi-remediation-plan/**
  - harness/specs/guides/rsi-remediation-roadmap.md
  - harness/specs/rules/rsi-public-input-boundary.md
  - harness/specs/tasks/rsi-public-task-inputs.md
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - rsi-public-input-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - paired-ablation-boundary
expectedUserBehavior:
  - A new coding plan supplies frozen public interfaces, task criteria and auditable base context for every declared task.
  - A missing new module is explicit and its public contract remains available without exposing reference implementation bodies or hidden tests.
  - Input drift, undeclared sources and truncated required contracts stop prospective admission before any provider request.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/rsi-task-inputs.test.ts tests/unit/rsi-coding-collector.test.ts tests/unit/rsi-benefit-eval.test.ts
  - node scripts/rsi-task-inputs.mjs --check --json
  - pnpm harness validate --spec harness/specs/tasks/rsi-public-task-inputs.md
acceptance:
  - All 24 historical tasks bind a public API or document/CLI contract, source identity and base/reference provenance.
  - Public declarations reject implementation bodies and private oracle sources; required contracts are never silently truncated.
  - New module tasks have usable declarations, and context discovery records source omissions and caller provenance explicitly.
  - RsiCodingCollector/v3 is opt-in and v1/v2 task/request projections retain their original semantics.
  - Negative controls reject stale source digests, changed contracts, leaked test or acceptance content, missing contracts and exhausted input budgets.
  - A clean committed candidate has focused regression results and hash-bound input/readback evidence; old measurement verdicts remain NO_GO.
docs:
  required: true
  note: Explain the new input protocol in the maintained capability guide and the RSI remediation roadmap; the change is an internal evaluator interface.
readmeUpdates: not-required
---

Implementation starts with `pnpm harness context --spec harness/specs/tasks/rsi-public-task-inputs.md`. Public declarations are evaluator-owned prospective inputs. They specify API shape while keeping the implementation and hidden oracle in the evaluator's historical workspace. The input checker reports exact missing, omitted and drifted items; it does not infer model success from declaration coverage.

