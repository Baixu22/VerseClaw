---
lifecycleStatus: active
id: rsi-evidence-loop-contract
title: Freeze the RSI capability matrix, baseline protocol and promotion policy
intent: Freeze what ClawX can and cannot do towards recursive self-improvement today, together with the pre-registered baseline, budget, promotion and rollback contract that every future RSI candidate must be judged against, without enabling any capability, changing any product default, or claiming more than the source and evidence on disk support.
touchedAreas:
  - harness/specs/tasks/rsi-evidence-loop-contract.md
  - harness/specs/fixtures/rsi-evidence-loop/**
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/fixtures/agent-first-acceptance/**
  - harness/specs/guides/agent-first-acceptance.md
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
  - tests/unit/agent-first-acceptance.test.ts
  - tests/unit/rsi-evidence-loop-contract.test.ts
  - scripts/agent-first-acceptance-check.mjs
  - scripts/agent-first-acceptance-check.d.mts
  - scripts/lib/agent-first-acceptance-contract.mjs
  - scripts/lib/agent-first-acceptance-contract.d.mts
  - scripts/repository-artifacts.json
  - .gitignore
  - harness/specs/tasks/rsi-*.md
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
expectedUserBehavior:
  - A reader can tell, per capability layer and per evidence level, exactly which RSI-related machinery exists today and which does not.
  - No RSI candidate can be promoted against a success criterion it was allowed to edit, because the task set, grader identities, budgets and thresholds are pre-registered in a reviewed fixture.
  - A five-case fixture is visibly insufficient rather than silently sufficient, and an unrun dimension reports not-run instead of passing by default.
  - The repository states in tracked documentation that ClawX has no complete RSI implementation, so planning artefacts cannot be read as shipped capability.
  - The static acceptance contract for agent-first acceptance is executable from disk and rejects malformed contracts instead of trusting a green command line.
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - docs-sync
  - task-forest-autoclose-and-roles
  - agent-engineering-acceptance-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - sekb-assisted-review-boundary
  - sekb-hermes-default-off-boundary
  - sekb-hermes-promotion-boundary
requiredTests:
  - node scripts/agent-first-acceptance-check.mjs
  - pnpm exec vitest run tests/unit/agent-first-acceptance.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rsi-evidence-loop-contract.md
  - pnpm run typecheck
acceptance:
  - The capability matrix separates experience-loop, harness self-modification and code self-modification, and marks every cell with its evidence level and a not-run verdict where nothing was run.
  - The baseline protocol fixes task-set provenance, a minimum of 20 complete cases, separate pass^k and pass@k reporting, 95% confidence intervals, a minimum detectable effect, cost/turn/tool-call budgets and four separated failure classes.
  - The promotion policy fixes absolute pass^k and interval thresholds, a bounded cost increase, zero-regression rules for negative and safety cases, single-flag rollback and the prohibition on reverse migration.
  - Default-off boundaries and the forbidden mutation set are recorded, and every automated artefact is labelled driven_by: agent with a concrete actor and no real-human claim.
  - The claim that ClawX has no complete RSI implementation is written down with the source and evidence paths that support it.
  - Prerequisite edges for the later RSI nodes are stated so no candidate generation or code self-modification is implemented before its stage gate.
docs:
  required: true
  note: Add docs/dev/rsi-capability-and-boundaries.md and retain it as a tracked reviewed input; READMEs stay unchanged because no user-visible behaviour changes.
readmeUpdates: not-required
---

# RSI evidence loop contract

## Why this spec exists

ClawX has no recursive-self-improvement loop. It has one flag-gated experience
loop (SEKB), a statistical aggregation library, and a planning tree that
describes stages that have not been built. Those three facts are easy to blur
together in prose: a plan that names a capability reads, six months later, like
a capability that exists.

This spec freezes the distinction before any candidate work starts. It produces
one capability matrix and one promotion policy, both machine-readable and both
reviewed as fixtures, so a later candidate is measured against criteria it never
had the authority to edit.

It deliberately implements nothing. Stage 0 exists to make later self-modification
experiments falsifiable, not to start them.

## Scope

In scope:

- `harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json` — the
  three capability layers, each cell carrying an evidence level and a verdict.
- `harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json` — the
  frozen baseline protocol, budgets, promotion thresholds, elimination rules and
  rollback contract.
- `docs/dev/rsi-capability-and-boundaries.md` — the reader-facing statement of
  the same boundary, including the explicit "no complete RSI implementation"
  claim.
- The static validation hardening of the agent-first acceptance contract that
  the capability matrix reuses for its own evidence fields.

Out of scope, and deliberately left open:

- TF-0604 (baseline and negative-control corpus), TF-0605, TF-0606, TF-0607,
  TF-0608, TF-0609, TF-0610.
- Any runtime or Python dependency on ACE, ReasoningBank, SICA, DGM, Darwin
  Gödel, OpenEvolve or AlphaEvolve. The repository currently contains zero
  references to any of them, and that stays true.
- Any change to a product default, product lock, approval semantic, release
  state or `liveReady` value.

## Where the boundaries come from

This contract composes existing rules instead of inventing a second model:

- `reliability-aggregation-boundary` already fixes k=3, a 20-complete-case
  minimum, `insufficient-sample` for thin samples, separate `pass^k`/`pass@k`,
  preserved incomplete trials and mandatory safety anchors.
- `paired-ablation-boundary` already fixes pre-registration, paired
  `(caseId, repeat)` comparison, 95 % intervals, and the rule that a change in
  default value may not follow from a positive effect.
- `sekb-assisted-review-boundary` and `sekb-hermes-default-off-boundary` already
  fix default-off, no automatic write-back and evidence honesty.
- `sekb-hermes-promotion-boundary` already fixes the Tier D0/D1/D2 layering and
  single-flag rollback with no reverse migration.
- `agent-engineering-acceptance-boundary` already fixes independent execution.

The RSI fixtures cite these rules by id and add only what is specific to a
self-improvement candidate: the three-layer capability split, the cost ceiling
expressed per completed case, and the rule that a candidate may never author its
own task set, grader, held-out split or evidence generator.

## Change-set ownership

This spec owns the whole change set it is delivered with, which is why
`docs/README.md` and `harness/specs/guides/agent-first-acceptance.md` are declared
even though this round does not edit them: the branch carries the two commits
that landed the agent-first acceptance contract, and the harness changed-path
ownership gate measures against the last pushed base. Naming them here keeps the
ownership gate honest instead of running it with `--no-diff` or a narrowed
`--since`.

The two nodes this change set delivers are TF-0589 (harden the acceptance
contract into an executable static check) and TF-0603 (freeze the RSI capability
matrix, baseline protocol and promotion policy). They share one change set
because the RSI fixtures reuse the agent-first contract's evidence and negative
control vocabulary.

## Acceptance evidence

The acceptance of this spec is read from disk, not from a command transcript:

- `harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json` records
  each cell's status, evidence level, the source paths that support it and an
  explicit `not-run` verdict where nothing was executed.
- `harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json` records the
  frozen thresholds and the forbidden mutation set.
- `docs/dev/rsi-capability-and-boundaries.md` states the current capability in
  prose and names the paths behind every claim.
- `harness/specs/fixtures/agent-first-acceptance/validation-report.json` records
  the static validation result and the negative controls that were rejected, so
  the evidence fields the matrix reuses are themselves checked.

Every one of these artefacts is `driven_by: agent` with a concrete actor. No
real-human evidence is claimed or required anywhere in this change set.
