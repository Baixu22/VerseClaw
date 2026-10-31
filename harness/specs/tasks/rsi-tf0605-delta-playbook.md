---
lifecycleStatus: active
id: rsi-tf0605-delta-playbook
title: Add offline SEKB delta playbooks and paired success/failure extraction
intent: Extend the existing SEKB SQLite knowledge model with an offline, advisory delta-playbook extractor that pairs successful and failed trajectories for the same task, emits versioned incremental candidates with contrastive evidence, diagnostics and baseline-versus-delta metrics, and requires the existing explicit confirmation path before anything enters persisted Knowledge.
diffBase: 26b664c5c
touchedAreas:
  - harness/specs/tasks/rsi-tf0605-delta-playbook.md
  - openclaw_runtime/src/knowledge/sekb/delta-playbook.ts
  - openclaw_runtime/src/knowledge/sekb/delta-playbook.test.ts
  - openclaw_runtime/src/knowledge/sekb/index.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0605/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0605/comparison-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0605/control-results.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0605/delta-playbook-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0605/evidence.v1.json
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
residualPaths:
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/resource-fingerprint.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/statistical-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/validation-report.v1.json
  - .gitignore
ownedPaths:
  - openclaw_runtime/scripts/generate-rsi-tf0605-evidence.ts
  - harness/specs/tasks/rsi-tf0605-delta-playbook.md
  - openclaw_runtime/src/knowledge/sekb/delta-playbook.ts
  - openclaw_runtime/src/knowledge/sekb/delta-playbook.test.ts
  - openclaw_runtime/src/knowledge/sekb/index.ts
requiredProfiles:
  - fast
requiredRules:
  - sekb-runtime-development-loop
  - sekb-assisted-review-boundary
  - sekb-hermes-default-off-boundary
  - docs-sync
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/rsi-tf0605-delta-playbook.md
  - openclaw_runtime: node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/delta-playbook.test.ts
  - openclaw_runtime: node scripts/generate-kysely-types.mjs --verify
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0605-delta-playbook.md
  - pnpm run typecheck
acceptance:
  - The extractor consumes existing Trajectory and Principle types without adding a second storage system, database schema, server, provider call or renderer surface.
  - Only deterministic success/failure pairs with the same task type and overlapping context are eligible; missing pairs, ambiguous outcomes, unsafe payloads and duplicate sources remain visible and cannot produce a promoted candidate.
  - Each emitted delta is an advisory, versioned update candidate carrying source trajectory ids, contrastive success/failure evidence, counterexamples, confidence and explicit unresolved conflicts.
  - Existing confirmed principles can produce add, revise, reject-merge and no-op decisions deterministically; no unconfirmed candidate can be written to Knowledge.
  - Baseline-versus-delta metrics cover paired task count, candidate adoption/pass counts, duplicate rate, injection token count and explicit insufficient-evidence status when samples or measurements are unavailable.
  - The existing 2K L1 index and explicit `DistillationTool.confirm_and_save` path remain in control; automated artifacts retain `driven_by: agent`, concrete actor, no real-human claim and default-off behavior.
docs:
  required: true
  files:
    - harness/specs/tasks/rsi-tf0605-delta-playbook.md
readmeUpdates: not-required
---

# TF-0605 SEKB delta playbook contract

TF-0605 adds an offline comparison surface to the current SEKB trajectory and
principle model. Success and failure trajectories for the same task type are
paired, then reduced to a deterministic, versioned delta candidate. The
candidate is advisory data for the existing review and confirmation flow.

The module does not write to SQLite, call a model provider, alter a product
default, change extraction prompts, or introduce a second knowledge store. A
confirmed candidate may enter the existing store only through
`DistillationTool.confirm_and_save`. Unpaired evidence, ambiguous outcomes,
duplicate trajectory ids, cross-task comparisons, unsafe payloads and missing
measurement data fail closed or remain explicitly unresolved.

The comparison report separates corpus coverage from result claims. A small
fixture may prove deterministic extraction, duplicate suppression and
counterexample preservation; it cannot establish adoption benefit or model
quality. Real benefit remains not-run until the frozen TF-0604 task corpus is
executed under the approved trial envelope.
