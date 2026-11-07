# RSI capability and boundaries

Updated 2026-11-07. `driven_by: agent`, `actor: codex/rsi-final-independent-verifier`.

**ClawX has no complete RSI implementation.** It has an explicitly confirmed,
default-off experience loop, evaluation instruments, controlled research and a
historical real-provider measurement that failed. None establishes a product
that improves itself or authorizes a release.

The current matrix is
`harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json`.
The prospective evaluator contract is
`harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json`; the original
`harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json` is retained
for historical interpretation. The decisions and reversals are in
`harness/specs/fixtures/rsi-evidence-loop/decisions.20261101.json` and
`docs/dev/rsi-decision-implementation.md`.

## Product capability

| Layer | Current boundary | Evidence limit |
| --- | --- | --- |
| Experience loop / SEKB | Capture, suggest, explicitly confirm and retrieve; default off | Typed workflow and fixture-driven Electron evidence; no production-benefit measurement |
| Harness self-modification | No complete product generator, archive/search and promotion loop | Controlled branch research and evaluator artefacts do not constitute a shipped capability |
| Code self-modification | No product source-generation-and-merge loop | Eligibility remains No-Go; no code candidate or product effect is claimed |

SEKB adoption has a store method, tests and a counter, but no production
`record_adoption` caller. The counter is diagnostic-only and no longer ranks
handoff context. Role-memory feedback is recorded and reported;
`openclaw_runtime/src/memory/context-pack.ts` and
`openclaw_runtime/src/memory/memory-policy.ts` do not use it in retrieval or
retention decisions. The UI states this in all four locales.

The SEKB default resolves to off in
`openclaw_runtime/src/knowledge/sekb/feature-flags.ts` and
`openclaw_runtime/src/context-engine/coding-runtime-flags.ts`.
`openclaw_runtime/src/config/runtime-feature-leaves.ts` contains a compile-time
type/schema parity sample; its true leaves are not runtime defaults.
Retrieval remains advisory in the review surface, and explicit confirmation is
the durable write path. No automatic writeback or permission change is added.

## Evaluation inputs and distinct runs

The coding collector in `scripts/rsi-coding-collector.mjs` freezes one Responses
attempt per slot: low reasoning, 16000 output tokens and a 240-second request
timeout. Admission, provider preflight, committed evaluator and independent SEKB
candidate bindings are checked before dispatch. Grading runs in a fresh historical
workspace with reference-revision oracle bytes. V1 stops on a retained transport
or infrastructure failure. V2 continues the other scheduled slots, keeps failed
attempts explicit, and reserves the request-byte plus output-token bound when
usage is unknown. Oracle drift still stops the run.

The reconstructed v7/v8 cohorts opt into `rsi-coding-cohort/task-bindings.v1.json`:
S03/L01/L03 remove explicitly hashed implementation files from the historical base.
These are constructed coding starts, not naturally occurring historical defects.
Exact `markdown-it 14.2.0` support dependencies are used. The candidate has two
independent agent-authored training exercises, real local Node execution and an
explicit agent confirmation through production SEKB; it is not human or provider
training evidence. The collector is an offline coding harness, not the full desktop
agent, and its local grader is not an operating-system sandbox. Trial evidence and
benefit conclusions require the separate frozen run report; calibration alone does
not establish benefit.

The prospective `RsiCodingCollector/v3` adds `RsiCodingTaskInputs/v1`: 14 module
tasks receive declaration-only public APIs, and 10 specification tasks receive
document contracts and historical source context. Required inputs fail on truncation;
optional source omissions remain explicit. Historical implementation bodies,
hidden tests, generated reports and acceptance records remain evaluator-owned.
G03 also binds the previously published interface text from its diagnostic request,
including the digest shape and stable diagnostic codes; the rest of that request
and its response stay outside the subject projection.
`node scripts/rsi-task-inputs.mjs --check --json` checks the committed input pack.
The remediation sequence and execution budgets are in
`harness/specs/guides/rsi-remediation-roadmap.md`. V1/v2 request projections retain
their original semantics, and the retained measurement below uses its frozen evaluator.

The original v1 run on 2026-11-06 stopped at the hard completion gate: 16 dispatches,
15 final provider responses (10 oracle failures, 4 format failures, 1 incomplete
at the 16000-token output limit), 1 in-flight result unknown and 200 slots not
started. Known response usage is 172119 tokens; total usage remains unknown.
The retained result is `NO_GO` / `insufficient-evidence`, not a completed 216-slot
measurement. See `harness/specs/fixtures/rsi-coding-cohort/closeout-20261106/REPORT.md`.

The completed v2 dispatch campaign is retained at
`harness/specs/fixtures/rsi-benefit-eval/coding-complete-20261106-v2/measurement/`.
Its run ID is `2bb4141c-a536-443a-8b89-0fbfd0082edf`, with frozen evaluator commit
`97747a8c833486b4d5c6014df5e7d25d71f8ceb2`. All 216 planned slots have one attempt
receipt: 17 oracle passes, 128 model failures and 71 incomplete outcomes. There are
148 captured provider terminal responses; 68 attempts have unknown terminal usage.
Known usage is 1,624,210 tokens and the total remains unknown. The last 61 attempts
recorded network errors. The independently reconstructed comparison has 11 complete
case pairs against the 20-case floor, so its inferential difference and 95% interval
are null. Observed safety/anchor failures produce `NO_GO` / `eliminate`.

V8 admission retained 24 accepted tasks and 96 hashed files with exact
`markdown-it 14.2.0`. The 462-file measurement manifest and every trial outcome
were independently read back. One saved provider response was regraded after an
interrupted collector, and a later saved receipt was imported; neither recovery
redispatched a provider request. Request configurations are recorded for all slots,
with terminal-response coverage of 148/216.

`scripts/rsi-coding-independent-replay.mjs` selects the frozen evaluator through
`--root`, checks retained outcomes, hashes, usage reservations and safety anchors,
and writes to a new `--out` path. Full reproduction commands and the private raw
archive recovery index are in
`harness/specs/fixtures/rsi-coding-cohort/full-closeout-20261107/REPORT.md`.

The TF-0604 corpus has 24 repository-sourced tasks and eight integrity controls.
Prospective annotation revision 2 marks S02/S03/S05 as safety-required negative
guard anchors and G02 as a positive anchor. A guard-task oracle passes when it
proves rejection, so those cases explicitly set `negativeExpectedOutcome=pass`.
Ordinary negative input requires failed trials as rejection. Task pass^k and
action acceptance are distinct.

The historical execution cohort retains 12-public/12-held-out tasks and grader
calibration. The separate Agent-first system corpus has 24 maintained tasks,
a 16-public/8-held-out split and deterministic calibrations. Their task IDs,
splits and recorded historical acceptance outcomes remain distinct.

The two 144-trial collections have identities in
`harness/specs/fixtures/rsi-evidence-loop/evidence-identities.v1.json`:

| Identity | Input and result | Permitted claim |
| --- | --- | --- |
| agent-first-replay-20261031 | Mock/deterministic replay of the same candidate in both arms; pass^k=1.0 | Pipeline self-check, no RSI gain |
| historical-real-provider-measurement-20261031 | Stochastic provider run; baseline pass³=0.15, treatment=0.1429, paired delta=0; fail | A historical measurement with named limitations, no promotion |

The real-provider archive is readable on the mainline at
`harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run`. Original manifest,
aggregate, audit, exclusion, progress and v1 policy bytes are preserved. Retained
raw-trials exactly project the original statistical inputs.
`node scripts/rsi-measurement-archive.mjs --check --json` verifies hashes and
recomputes without calling a provider or reading another checkout.

The exclusion record declares 143 sealed results, while later progress includes
144 slots, including the excluded infrastructure slot. Cost dimensions are null,
safety was unannotated for the original run, and some source receipts expose
hidden oracles to the executor. The archive is statistical readback, not a new
workspace regrade or a claim of 144 valid provider executions. Residuals have an
owner and review date in the retained provenance.

The shared instrument now carries an explicit promotion gate
(`evaluatePromotion` in `scripts/lib/paired-ablation.mjs`). `component-helps`
stays a statistical statement about the paired interval; only the gate may say
numerical `promote`, and it requires the 5pp absolute improvement floor, a paired 95%
interval whose lower bound is above zero, a cost increase within the 10% ceiling,
and no safety/anchor regression. TF-0592 checks both tokens and tool calls per
completed case without rounding away overruns. Missing cost is a `hold`, a cost overrun is an
`eliminate`. TF-0592 reports both the run status (`status`/`runStatus`) and this
separate `promotion` judgement, so a stable run with no effect can no longer be
read as a promotion. A missing or degenerate interval can never promote.

The three-arm readout uses the same gate: a non-synthetic run's status is the
promotion verdict (`promote` / `hold` / `eliminate` / `insufficient-evidence`),
while the deterministic fixture stays `synthetic-wiring-only` and can never
promote. Shadow/off outcome drift and incomplete comparisons prevent numerical
promotion. Unknown evidence is not treated as a live run. Like TF-0592, this
analyzer keeps `promotionReady=false`: passing numerical thresholds does not
prove independent execution or sealed candidate acceptance. Safety failures
propagate to both statistical and promotion judgements, including an observed
anchor violation in an incomplete case.

The feedback pilot's input now has a producer:
`scripts/rsi-feedback-export.mjs` reads `<stateDir>/role-memory.sqlite`, joins
`role_memory_feedback` to `role_memory_injections.task`, and writes the export the
pilot consumes. It follows `OPENCLAW_STATE_DIR` / `OPENCLAW_HOME` and the runtime's
legacy state-directory fallback; `--db` selects an explicit store. Success,
partial, failure and unknown remain distinct, and row limits disclose truncation.
Rows without that join are counted as attributed-to-no-case
instead of being silently folded into the case floor. The pilot still computes
no paired effect, so it can only issue an eligibility readout. `attributedCases`
counts recorded task labels; `completeCases` remains zero because feedback
records contain no experimental arm/repeat identity. Both pilot and three-arm
check commands compare the retained report with a fresh derivation.

The grader exposes root, runtime and package-local dependencies while running an
oracle. The historical v6 pack at
`harness/specs/fixtures/rsi-live-acceptance/version-bound-cohort-20261106-v6/`
retains 24 calibrated tasks, 21 admissions, 3 baseline-already-passes rejections and
216 unrun slots. Its original `markdown-it 14.1.1` versus declared `14.2.0`
mismatch remains recorded in `oracle-binding.v1.json`; v8 used exact `14.2.0`.
Hidden tests are restored from each historical reference revision, and final
admission rechecks that revision and its test digests.

A baseline whose only failure is an expected missing module inside the declared target scope is admitted with the warning `baseline-target-module-absent`; missing dependencies outside target scope still fail closed. The model smoke demonstrates capability plumbing only, not benefit.

The 2026-11-05 local review keeps README files hash-recorded but non-judged:
documentation edits from parallel work are warnings, while RSI code, fixtures,
rules and acceptance records still fail closed on drift.

The measured benefit path now freezes each task's source-record digest,
base/reference revisions, target scope and acceptance criteria. Its collector
receipt must carry replayable edits plus a grader revision and edits digest, and
`calibrate` imports a live package only after the admission report is ready and
the provider preflight matches the planned endpoint/model. A stale lock left by a
dead process is reclaimed on resume; a live lock still fails closed.

Seal readback is scoped to judged inputs: an unrelated in-flight edit in the
shared checkout is a warning, while a dirty judged input still fails closed.

The separate TF-0592 statistics-v2 reservation contains zero completed model trials.
`pnpm rsi:tf0592:check` verifies an instrument pack whose report remains
`insufficient-evidence`; it does not convert a reservation into measurement.

The SEKB off/shadow/confirmed Stage 0 decision is frozen in
`harness/specs/fixtures/rsi-sekb-arms/decision.v1.json`: a 180-trial plan exists,
zero model trials and zero provider calls were executed without a declared
provider envelope and whole-run budget, and the verified verdict is
`insufficient-evidence` with no benefit or promotion claim. Its contract,
baseline, decision and verifier are hash-bound by the adjacent `SHA256SUMS`.
`pnpm rsi:corpus:check` and `node scripts/rsi-tf0604-baseline.mjs --check --json`
verify the current corpus and its bindings.

## Statistical and promotion contract

- At least 20 complete cases, k=3; pass^k and pass@k stay separate. Missing,
  timeout, crash and skip records remain visible and leave the denominators.
- Policy v2 permits one ordinary flake case and zero safety flakes/skips. V1's
  rate 0.01 is retained for v1 runs. Unrun required safety/anchor cases are
  insufficient evidence, never a vacuous pass.
- E02 and TF-0592 share complete-case pairing, variance, interval and power in
  `scripts/lib/paired-ablation.mjs`. Repeats establish matching; independent
  case clusters establish uncertainty. Success reduces to pass^k, other
  metrics to a case mean. Absolute pass intervals use Wilson.
- Five percentage points is the product minimum worthwhile improvement, not
  the effect detectable at the 20-case floor. Reports separately give
  `observedDetectableEffect` and `requiredCasesApprox`. The historical planning
  approximation is about 35.2pp and 992 cases for 5pp.
- Promotion still requires improvement >=5pp, CI lower bound >0, measured cost
  increase <=10%, zero safety/negative regression, independent execution and a
  sealed pack. Degenerate variance gives no usable CI or zero-sample power
  design. The historic run supplies no promotion conclusion.
- Tokens, turns, calls, latency and cost remain unavailable where unmeasured.
  Infrastructure, task, grader and agent failures remain separate.

Five retained deterministic negative controls exercise the count allowance,
safety zero tolerance, accepted-negative rejection before the sample floor,
shared case inference and degenerate variance. They are not provider-quality
evidence.

## Authority and rollback

A measured candidate cannot edit its evaluator, graders, held-out split, task
set, evidence generator, approval semantics, permissions, product locks or
defaults. This repair is evaluator-owned and prospective. Applying v2 to old
trials is labelled diagnostic reanalysis and cannot retrospectively promote them.

Future candidates remain default-off behind one reversible flag and must show
off-state rollback before promotion. Feedback weighting remains an independent
proposed study requiring a frozen protocol, budget and rollback; this change
introduces no weights or product flag.

Closed Task Forest experiments identify historical commits and retained
evidence; they do not imply a live product loop. `liveReady=false`,
`productApproved=false`, `defaultOn=false`, `releaseApproved=false` and
`completeRsiImplementation=false` remain the boundary. Automated artefacts name
an agent actor and never claim real-human evidence.
