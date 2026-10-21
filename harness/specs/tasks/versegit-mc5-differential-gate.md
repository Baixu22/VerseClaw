---
lifecycleStatus: active
id: versegit-mc5-differential-gate
title: MC5 - build the differential migration gate
scenario: versegit-validation-layer-extension
taskType: planning
intent: Make migration-versus-rewrite machine-decidable, with a numeric diff budget, a semantic projection, behavior-change records and negative controls, before any adapter slice is implemented.
touchedAreas:
  - harness/specs/tasks/versegit-mc5-differential-gate.md
  - harness/specs/tasks/versegit-module-implementation-contracts.md
  - harness/specs/fixtures/versegit-planning-correction/mc5-differential-fixture.json
  - harness/specs/fixtures/versegit-planning-correction/mc5-evidence/**
  - scripts/versegit-mc5-differential.mjs
  - scripts/verify-versegit-mc5.mjs
  - tests/unit/versegit-mc5-differential.test.ts
expectedUserBehavior:
  - A migration slice that is whitespace-only, comment-only, over budget or spans two seams is refused instead of being accepted as a refactor.
  - Any behavioral difference against the frozen original is refused unless an explicit behavior-change record names the old behavior, new behavior, reason and verification.
  - A projection that hides unknown, unobserved or partial evidence is refused, so information loss cannot be laundered into a clean result.
  - Every differential result is traceable to the node, the consumer contract, the golden bundle, the sidecar package and the frozen source commit.
requiredProfiles: []
requiredRules:
  - versegit-validation-layer-extension-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
requiredTests:
  - node scripts/versegit-mc5-differential.mjs --out harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json
  - node scripts/verify-versegit-mc5.mjs --artifact harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json
  - pnpm exec vitest run tests/unit/versegit-mc5-differential.test.ts
  - pnpm harness validate --spec harness/specs/tasks/versegit-mc5-differential-gate.md
acceptance:
  - The report fixes a numeric diff budget (files per seam, lines per seam, lines per file) and the exempt file classes, and refuses any slice that exceeds it or mixes seams.
  - At least three representative inputs across distinct seams are compared through a declared semantic projection, and each is golden-equal with no behavior-change record claimed in this node.
  - At least six named negative controls fire: whitespace-only diff, over-budget slice, multiple seams, undeclared behavior change, swallowed unknown evidence, and provenance drift.
  - The code-similarity check declares itself a whitespace and comment normalization proxy rather than a full parse, and docs, schema and config files are exempt from the no-op rule.
  - The report states that no adapter comparison is available yet: this node proves the gate and its oracles, and MC4 must earn equivalence against the real adapter.
docs:
  required: true
  files:
    - harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md
---

# MC5 differential migration gate

This node builds the gate that decides whether a migration slice preserved behavior.
It does not implement the adapter, the observation bridge, the harness profile or the
VerseShell receipt bridge, and it never invokes `vg land` or `vg admit`.
