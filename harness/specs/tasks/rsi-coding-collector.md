---
lifecycleStatus: active
id: rsi-coding-collector
title: Redefine solved verification tasks and freeze a bounded RSI coding collector
intent: Complete local RSI admission and coding collection with explicit reconstructed starts, exact oracle support dependencies, immutable provider attempts and honest cohort-scoped evidence.
diffBase: aeba2c146c373d721a3305a48c39a2c06f0ccd8d
touchedAreas:
  - scripts/rsi-*.mjs
  - scripts/rsi-*.mts
  - scripts/rsi-*.d.mts
  - scripts/lib/rsi-*.mjs
  - scripts/lib/rsi-*.d.mts
  - tests/unit/rsi-*.test.ts
  - harness/specs/tasks/rsi-*.md
  - harness/specs/fixtures/rsi-coding-cohort/**
  - harness/specs/fixtures/rsi-live-acceptance/reconstructed-cohort-20261106-v7/**
  - harness/specs/fixtures/rsi-benefit-eval/coding-20261106/**
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
  - paired-ablation-boundary
expectedUserBehavior:
  - Historical v6 evidence remains reproducible; coding redefinitions are separately opted into and frozen.
  - S03, L01 and L03 reconstruct declared missing implementation files and are never described as natural historical bug-fix starts.
  - Provider, infrastructure, oracle and model failures retain their distinct causes without silent retries.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/rsi-coding-collector.test.ts tests/unit/rsi-live-grader.test.ts tests/unit/rsi-live-acceptance.test.ts tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-responses-provider.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/rsi-coding-collector.md
  - git diff --check
acceptance:
  - Each reconstructed start binds its original source record, base/reference revisions, removed implementation paths and their base blob hashes; no oracle bytes are changed.
  - Reconstruction removes only declared target files in a new D:/tmp workspace, before applying subject edits. The reference stage stays intact.
  - V7 independently calibrates all 24 tasks with exact markdown-it 14.2.0 and retains original failed admission evidence.
  - A collector freezes endpoint, model alias, low reasoning effort, output budget, timeout and JSON edits schema; one slot permits one provider attempt.
  - Only declared task source and base context reach the subject. Hidden tests, reference implementations, credentials and grader metadata never enter the request.
  - Actual edits, request/response/usage, command reports and receipt digests are retained. Independent grading runs in a fresh workspace with frozen oracle bytes.
  - A live benefit run requires 24 admissions and a separately frozen independent SEKB candidate before 216 slots. Missing prerequisites remain NO_GO, and insufficient or negative benefit remains a valid outcome.
  - Full checks use an isolated committed source projection. Reused dependencies are not called a fresh install, and unrelated shared edits remain preserved.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# Coding cohort boundary

The original S03/L01/L03 tasks verified already implemented behavior. L03's
lease/ack/release API exists even at the repository's initial import. The coding
cohort therefore explicitly redefines these three as implementation reconstruction:
remove only the declared source files from the original historical base and ask
the subject to restore their behavior. These are constructed starts, not recovered
historical bugs. Historical source records, identities, split membership, reference
revisions and hidden oracle bytes remain unchanged. No product files are removed
from the shared checkout.

`harness/specs/fixtures/rsi-coding-cohort/task-bindings.v1.json` is the versioned
redefinition input. Calibration and measurement must bind its digest and report
the reconstruction limitation. Old runs without this opt-in retain old semantics.

The frozen candidate uses two independently authored JSON roundtrip and array-copy
exercises. Their initial failures and repaired passes were executed by Node before
measurement, then captured, distilled, explicitly confirmed by an agent, persisted
and recalled through the existing SEKB components in an isolated SQLite database.
`candidate.json` and `candidate-provenance.json` bind this origin; it is agent-authored
training, not provider training or human evidence. Reproduce a new candidate with
`node openclaw_runtime/node_modules/tsx/dist/cli.mjs --tsconfig openclaw_runtime/tsconfig.json scripts/rsi-coding-candidate.mts --output D:/tmp/<new-candidate>`.
Never replace the frozen candidate during a measured run.

The collector recomputes all task admissions and the provider preflight before its
first request. Each slot writes an exclusive dispatch marker before sending; a
transport error, unknown usage or interrupted dispatch halts the campaign without
retry. Raw provider attempts remain visible even if independent grading fails.
Script oracles retain command exits and output digests; Vitest oracles retain test
paths, assertion counts and frozen test digests. A malformed model answer is a model
failure, while provider, dependency, timeout and oracle drift failures remain distinct.
