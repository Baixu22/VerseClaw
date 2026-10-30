# RSI capability and boundaries

Status: frozen for stage 0 (2026-10-30). Agent-driven record; no human verdict is
claimed or required.

This document states what ClawX can and cannot do towards recursive
self-improvement (RSI), and which success criteria a future candidate will be
measured against. It exists because a plan that names a capability reads, months
later, like a capability that exists.

## The claim, up front

**ClawX has no complete RSI implementation.**

It has one flag-gated experience loop, some statistical aggregation code, and
planning documents. None of those is a system that improves itself.

The machine-readable form of this claim is in
`harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json`, and the
frozen success criteria are in
`harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json`. Both are
tracked fixtures that a later reader can check against the source without
trusting this page.

## Three layers

The TF-0604 historical corpus now contains 24 repository-sourced task definitions
and eight integrity controls. TF-0592 adds resource/source fingerprints, separate
pass^k/pass@k with Wilson case intervals, paired-trial comparison, a labelled
power-design approximation and twelve fail-closed controls. Its checked-in raw
input still reserves zero completed model trials: the resulting report is
`insufficient-evidence`, with no model/provider gain or promotion readiness.
Trial execution, calibrated graders and enforced clean profile isolation remain
Agent-first prerequisites. `pnpm rsi:tf0592:check` re-reads and recomputes the
retained pack; `pnpm rsi:tf0592:write` prepares evidence and labels dirty source
as a draft. These tools leave the product capability boundary unchanged.

The historical execution cohort adds explicit input/acceptance text and current executable oracle/test
digests for these 24 historical tasks, a sealed 12-public/12-held-out split, and
three graders. Its calibration has 16 good/bad/unknown samples; qualitative
calibration uses three actual provider votes per sample at temperature 0.3 with
the dated `claude-haiku-4-5-20251001` model. The first prompt's missing-evidence
failure remains in the pack alongside v2. Historical A04 `NO-GO` and nonzero
gates remain visible. Task/grader calibration does not provide system baseline
trials; the acceptance profile and RSI baseline still report not-run or
insufficient-evidence until their actual execution is performed.

The accepted TF-0590 system corpus is separately retained under
`harness/specs/fixtures/agent-first-system`: 24 maintained QA and failure-boundary
tasks, a 16-public/8-held-out split and 144 deterministic grader calibrations.
`pnpm agent-first:corpus:check` verifies that collection. The historical cohort
uses `pnpm rsi:corpus:check` and a registry extension with distinct IDs; neither
collection rewrites the sealed base acceptance registry or the other's split.
The original historical reference execution observed 23/24 passing tasks and an
S04 runtime failure. That dirty-worktree reference replay is preserved separately
and supplies no complete system baseline cases.

The capability question is asked at three layers, and the three answers are
different.

### Layer 1 — Experience loop (SEKB): present, default off, human-confirmed

SEKB runs a reviewed suggestion pipeline with five stages. Each stage below is
recorded with the strongest evidence level actually observed, not the strongest
level planned.

| Stage | State | Strongest evidence | What is missing |
| --- | --- | --- | --- |
| capture | present, flag-gated | runtime, in an Electron host-api E2E run | The harness hooks install only when the master flag is set, so a default configuration captures nothing |
| suggest | present | runtime, typed host-api workflow | No live-provider distillation result |
| confirm | present | runtime, with a persisted-block read-back receipt | Requires an explicit actor action; the recorded effect is fixture-driven |
| retrieve | present, advisory only | runtime | The rule forbids auto-attaching retrieved text, so retrieval cannot produce an effect by itself |
| adoption | typed surface only | engineering (unit tests) | **No production caller.** A whole-repository search finds `record_adoption` invoked only from tests, so the persisted adoption count stays at zero and the surface that displays it is a dead read |

Two boundaries carry the weight here:

- **Default off.** `runtime.contextBlock.sekb.enabled`, overridden by
  `OPENCLAW_SEKB_ENABLED`, resolves to false when unset
  (`openclaw_runtime/src/knowledge/sekb/feature-flags.ts`). The zod leaf in
  `openclaw_runtime/src/config/zod-schema.ts` is optional with **no** default, so
  an absent setting means off rather than "unspecified".
- **No automatic write-back.** Nothing writes a principle back into an agent
  prompt, a prompt file, a skill, a harness spec or product source. The nearest
  mechanism is a flag-gated, per-turn injection that appends confirmed principle
  text while a turn's context is assembled. It assembles a turn; it writes no
  file; it is off by default. The boundary is enforced by
  `harness/specs/rules/sekb-assisted-review-boundary.md` and
  `harness/specs/rules/sekb-hermes-default-off-boundary.md`.

#### Read `runtime-feature-leaves.ts` carefully

`openclaw_runtime/src/config/runtime-feature-leaves.ts` sets
`contextBlock.sekb.enabled` to `true`, and `coding.sekb` leaves to `true` as
well. **This is not the product default.** That file is the compile-checked
type/zod parity sample for `RuntimeFeatureConfig`; its own header explains that
every leaf needs one sample value so the parity guard can fail to compile when a
leaf is added. Anyone citing it as evidence that SEKB ships enabled has misread
it. The real coding default for the same surface is `false`, declared in
`openclaw_runtime/src/context-engine/coding-runtime-flags.ts`.

### Layer 2 — Harness self-modification: does not exist

Nothing generates a candidate change to ClawX's own harness — its prompts,
specs, rules, gates, skills or agent configuration — evaluates that candidate
against a gate, or lands it. There is no flag for this, because there is no
capability to flag.

Two things look like exceptions and are not:

- `resources/skills/preinstalled/self-improving-agent/` is a bundled
  third-party skill a *human* invokes to log a learning. It is a static
  resource, is not wired to any loop, and generates no harness change.
- An AI coding agent edits this repository under human review. That is assisted
  authoring by an external agent, not the product modifying itself.

### Layer 3 — Code self-modification: does not exist

Nothing generates a candidate change to ClawX's product source, evaluates it,
or merges it. A repository-wide search finds **zero** references to ACE,
ReasoningBank, SICA, DGM, Darwin Gödel, OpenEvolve or AlphaEvolve.

The self-healing code that does exist is unrelated and bounded: gateway
reconnect, config-migration repair, and a versioned write journal with undo.
None of them authors or merges new product behaviour.

### Instruments are not capability

`scripts/lib/reliability-aggregation.mjs` (pass^k / pass@k, k=3, a 20-complete-case
floor, flake detection, `insufficient-sample`) and `scripts/lib/paired-ablation.mjs`
(paired effect size with a 95 % interval) are **instruments**. An instrument that
can measure an improvement is not an improvement. They are listed separately in
the matrix for that reason.

Two facts about the instruments themselves:

- Their only inputs today are fixture-grade. `shared/agent-dev/reliability-fixture.json`
  holds 5 cases at k=3 with 4 complete, so the gate correctly reports
  `insufficient-sample`. A five-case fixture may prove that aggregation runs and
  that a thin sample is detected; it may never be cited as benefit evidence.
- The pass^k report output directory `artifacts/agent-dev-benefit-eval/` does not
  exist in this checkout, so no baseline aggregation has been run and recorded.
  A minimum detectable effect is a **pre-registered design constant** here, not a
  computed output: the repository contains no bootstrap and no power analysis.

There is also no production grader or judge. Judge helpers exist only inside unit
tests. The only confidence-interval and agreement mathematics in the product is
the SEKB offline path (`openclaw_runtime/src/knowledge/sekb/shadow-evaluation-offline.ts`,
a Wilson interval at 0.95 and Cohen's κ with frozen thresholds).

## What a future candidate will be judged against

Frozen in `harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json`,
which composes existing rules rather than inventing a second model:
`reliability-aggregation-boundary`, `paired-ablation-boundary`,
`sekb-assisted-review-boundary`, `sekb-hermes-default-off-boundary`,
`sekb-hermes-promotion-boundary` and `agent-engineering-acceptance-boundary`.

In short:

- **Task set.** Provenance recorded, at least **20 complete cases**, k=3, a
  sealed held-out split, and a five-case fixture explicitly graded as
  fixture-grade only. A zero pass rate is a task or grader defect signal until a
  reference solution says otherwise.
- **Graders.** A deterministic final-state oracle decides whenever one exists; a
  model grader is supplementary and can never override a deterministic failure.
  Grader, judge, model and prompt digests are pinned.
- **Statistics.** `pass^k` and `pass@k` are reported separately and never mixed.
  A 95 % paired interval decides the verdict by whether it excludes zero. A zero
  or negative effect is a valid, reportable result.
- **Budgets.** Tokens, turns, tool calls, latency percentiles and a wall-clock
  ceiling are recorded per completed case; cost may rise by at most **10 %**.
- **Failure classes.** Infrastructure, task, grader and agent failures are
  counted separately and never merged. A timeout, skip or failure is preserved
  and excluded from the denominator — never silently dropped.
- **Promotion.** All of: `pass^k` absolute improvement **≥ 5 percentage points**,
  the interval's lower bound **strictly above zero**, cost increase ≤ 10 %, zero
  regression on negative controls, and zero regression, skip or flake on
  safety-required cases.
- **Elimination.** Any regression on a negative or safety case eliminates a
  candidate even when accuracy improves. So does a sample below the floor, a
  threshold moved after the run, a dropped timeout, or an untracked input.
- **Rollback.** Default off, reachable through exactly one flag whose off state
  reproduces prior behaviour, with the off state exercised and recorded before
  promotion. No reverse-migration dependency: a candidate needing an
  irreversible migration is disqualified.

## What a candidate may not touch

A candidate is never permitted to edit its own success criteria. The evaluator,
any grader or judge implementation, the held-out split and its seal, the evidence
generator and sealing path, the permission model and approval semantics, product
locks and frozen default values, the task set and its calibration, and the
promotion policy itself are writable only by the harness owner, in a separate
reviewed change set outside the candidate's scope. A diff touching any of them
invalidates the run.

## Evidence honesty

Every automated artefact in this track records `driven_by: agent` with a concrete
actor name. No artefact claims a human verdict or human-provided data, and no
criterion above requires one. A fixture-driven or synthetic run is labelled as
such, is never upgraded to live, and never claims generalization or billing
accuracy.

## Prerequisites for what comes next

- **TF-0604** (baseline and negative-control corpus) depends on **TF-0590** and
  **TF-0592**; it is where the real task corpus and the computed statistical
  floor belong.
- **TF-0605** and **TF-0606** depend on **stage 1** (TF-0599). No candidate
  generation before a trusted evaluation gate exists.
- **TF-0609** depends on **stage 3** (TF-0601). Code self-modification is only
  researched after the anti-contamination and promotion gates land.
- Skipping a stage invalidates the contract in this document.

## What this document does not claim

It does not claim that any capability described here produces a benefit, that any
candidate has been evaluated, that the aggregation gate has ever run here, that
any default should change, or that anything is ready for release. Enabling,
promoting, publishing or changing a product default is a separate decision, and
none of it is authorized by this page.
