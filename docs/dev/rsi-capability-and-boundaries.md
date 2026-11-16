# RSI capability and boundaries

Updated 2026-11-08. `driven_by: agent`, `actor: codex/rsi-remediation`.

**ClawX has no complete RSI implementation.** It has an explicitly confirmed,
default-off experience loop, evaluation instruments, controlled research and a
historical real-provider measurement that failed. None establishes a product
that improves itself or authorizes a release.

The 2026-11-07 baseline matrix is
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
| Experience loop / SEKB | Capture, suggest, explicitly confirm, retrieve and record versioned adoption; default off | Production adoption events and an agent-driven edit are covered; the retained v4 prompt measurement eliminates its staged candidate |
| Harness self-modification | No complete product generator, archive/search and promotion loop | Controlled branch research and evaluator artefacts do not constitute a shipped capability |
| Code self-modification | No product source-generation-and-merge loop | Eligibility remains No-Go; no code candidate or product effect is claimed |

The enabled SEKB extension now calls `record_adoption` with
`RsiExperienceAttribution/v1` receipts. It exposes the principle id and content
digest with advice, records retrieval separately, and registers
`record_sekb_adoption(principleId, principleVersion, trigger, operationToolCallId?)`.
An agent can cite a retrieved principle or attribute a successful observed
operation to it. The operation belongs to the same run; task, session and explicit
experiment/arm/repeat coordinates come from the executor. Missing coordinates
remain null.

The shared SQLite ledger retains rejection reasons, duplicate counts, conflicting
replays and unknown outcomes. Counters advance once per accepted principle
version/run. Operational completion and independently graded task outcomes have
separate sources; `post_adoption_success` advances only after an adopted version
has a known successful task grade. The extension event containing only messages
records an unknown operational outcome. Deleting a principle or its attributed
trajectory removes the corresponding receipt data.

`node scripts/rsi-adoption-integration.mjs` runs the focused regressions, verifies
generated schemas and reads the real edit and SQLite events back into a fresh
local evidence folder. `node scripts/rsi-adoption-export.mjs --db <state>/state/openclaw.sqlite`
exports the ledger read-only; `--check --input <export.json>` recomputes receipt
identities, digests and diagnostics. TF-0855 final evidence is in
`harness/specs/fixtures/rsi-experience-adoption/closeout-20261108/`.

Controlled prompt evolution is explicitly invoked through
`scripts/lib/rsi-candidate-evolution.mjs`. It freezes disjoint training,
validation and final-evaluation identities before generation, then records
parent-linked prompt versions, source digests, versioned adoption, reservations
and screening decisions in the existing SEKB trajectory table. Training tool
payloads retain the existing quarantine policy; the generator receives curated
summaries and observation digests. Original training executions are retained in
the engineering evidence pack.

Generation reserves its complete envelope before the callback runs. Duplicate
attempts keep the first record; timeouts, invalid output and unknown usage retain
their reservation. The validation selector uses the frozen policy v2 paired
instrument, including both token and tool-call costs. An unbounded increase from
a zero baseline is recorded explicitly. A frozen rule selects the first qualifying
generation as the candidate for final measurement; product adoption remains a
separate decision. The evaluation switch defaults to off
and returns the previous prompt bytes before inspecting a candidate.

`node scripts/rsi-candidate-evolution-integration.mjs` executes two generations
and reads the SQLite records back. The first scripted validation is eliminated;
the second clears the numerical control gate, is selected for final measurement
and remains `hold` for product adoption. These records
are agent-driven and contain zero third-party provider calls. Final task results
remain outside generation and screening. `node scripts/rsi-candidate-evolution.mjs
export --db <state.sqlite> --run-id <id> --out <new.json>` reads the records without
writing the database; `check --input <export.json>` recomputes their bindings.

A screened staged version can be bound to `RsiBenefitPlan/v2` with
`--candidate-evolution <export.json> --candidate-generation 2`. This keeps the
v4 tool protocol and freezes the same final task identities and prompt version.
The new plan requires its own declared measurement budget. TF-0856 curated
evidence is in `harness/specs/fixtures/rsi-candidate-evolution/closeout-20261108/`.

`node scripts/rsi-paired-measurement.mjs` prepares, calibrates, runs and checks a
fresh staged-prompt experiment in a new directory under `D:/tmp`. Its `prepare` command takes an owner-authorized
budget file, the sealed evolution export and a read-only local quota database.
`calibrate` executes the historical reference and unresolved baseline for each
task. `run` reads the provider key from stdin and retains the preflight, all
provider turns, tool effects and final historical oracle results. `check`
recomputes the measurement and joins each provider receipt to its reservation.

`RsiCampaignBudget/v1` adds one whole-campaign envelope to the v2 benefit plan.
Preflight and continuations share its call, token and currency limits. Unknown
usage keeps the request's upper reservation after interruption. The Free-quota
path verifies the timestamped WorkBuddy model cache, identity aliases and enabled
accounts for the frozen route before each request; it uses existing credits and allows
no purchase or paid fallback.
The report retains the provider's credit multiplier, new-spending bound in CNY
and any unavailable upstream invoice or credit debit as separate fields.

Adoption feedback remains diagnostic. Role-memory feedback is recorded and reported;
`openclaw_runtime/src/memory/context-pack.ts` and
`openclaw_runtime/src/memory/memory-policy.ts` do not use it in retrieval or
retention decisions. The UI states this in all four locales.

The SEKB default resolves to off in
`openclaw_runtime/src/knowledge/sekb/feature-flags.ts` and
`openclaw_runtime/src/context-engine/coding-runtime-flags.ts`.
`openclaw_runtime/src/config/runtime-feature-leaves.ts` contains a compile-time
type/schema parity sample; its true leaves are not runtime defaults.
Retrieval remains advisory in the review surface, and explicit confirmation is
the path for changing principle content.

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

`RsiCodingCollector/v4` adds declared source reads, batched exact edits and public
syntax/export checks. It freezes four provider calls, twelve executed tool calls,
12000 characters per tool output and 256000 UTF-8 edit bytes per slot. A final
`{"finish":true}` acknowledges the files already written, so the model does not
repeat full file contents. Provider continuations, tool arguments/results, file
digests and budget starts are checked against the frozen source projection;
historical oracles run after public checks. The standalone
`node scripts/rsi-coding-tool-integration.mjs` exercises this path with a scripted
provider and real historical oracle bytes.

The v4 measurement on 2026-11-09 has run ID
`e8866141-a1f3-43c4-8efa-dfc9822cd24d` and frozen evaluator
`fb2d09a3a401deecace0ccdcb6d9fc71da0b9693`. It measures the staged second-generation
prompt under the declared 24-task, three-arm, k=3 protocol. The campaign recorded
198 of 216 slots: four oracle passes, 193 model failures and one incomplete budget
stop. The remaining 18 slots were not started. Of the model failures, 192 reached
the four-call limit and one failed its final-state oracle.

Confirmed/off has 22 complete case pairs; shadow/off has 21. All three arms have
pass^3=0, and the primary paired difference is zero. The zero variance leaves its
95% interval and power estimate unavailable. Anchor failures and a shadow-arm
safety flake eliminate the candidate. The original completion check retains its
missing-slot failure. The final evidence is under
`harness/specs/fixtures/rsi-paired-measurement/closeout-20261109/`.

The shared ledger reconciles 791 requests, including two preflights, to 11,933,697
known tokens plus a 721-token upper reservation for the first authentication
failure. Accounted consumption is 11,934,418 of the authorized 12,000,000 tokens;
the next initial request needs 118,410 tokens while 65,582 remain. Existing Free
quota gives a new-spending upper bound of 0 CNY; upstream credit debit and invoices
remain unavailable. Off/on/off restores the previous prompt bytes, and a fresh
Node process rebuilds the same off request from the retained elimination decision.

`node scripts/rsi-paired-measurement-replay.mjs --root <frozen-checkout>
--base-dir <campaign> --scratch <receipts> --out <new.json>` independently reconstructs
case statistics and accounting from retained v4 data. It verifies the frozen source,
Responses continuations, public tool effects, historical oracles and hash manifest.
Run `node scripts/rsi-benefit-eval.mjs report --run-dir <campaign>/measurement` to
regenerate a retained report before checking it. The original pre-trial report,
first authentication failure and first calibration failures remain in the private
recovery archive.

The collector regenerates its final report after an exception when new receipts
were imported, then propagates the original stop error. `node
scripts/rsi-budget-stop-regression.mjs --frozen-root <checkout> --campaign <campaign>
--scratch-source <receipts> --support-root <dependencies> --out <new.json>` exercises
that path with retained receipts in a fresh temporary fixture. It blocks provider
dispatch and checks the report before and after the token-budget refusal.

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

The protocol-contrast command freezes a separate off-only study with v2 legacy
JSON input, v3 public JSON input and v4 bounded public tools. It compares
v3 minus v2 and v4 minus v3 on the same 24 historical tasks, repeated three
times in rotating version order. A shared ledger covers one preflight and up
to 432 task requests; every request reserves tokens and verifies the Free route
before dispatch. Retained receipts can be imported after interruption without
repeating a model request. Replay checks raw Responses, tool effects, oracle
reports and case-level statistics from disk.

`node scripts/rsi-protocol-contrast.mjs <prepare|calibrate|run|check>` accepts
`--base-dir`, with the run additionally taking `--scratch`, `--support-root`
and `--quota-db`. Preparation takes `--budget-file`; credentials reach the run
through JSON on stdin. The 2026-11-09 authorization is 12M tokens, 433 calls
and 0 CNY new spending using existing Free quota. Independent arithmetic runs
through `node scripts/rsi-protocol-contrast-replay.mjs --root <checkout>
--base-dir <study> --scratch <receipts> --out <new-report>`.

If an unsuccessful oracle exits with zero test suites, the recovery command
retains the original receipt and records `missing` with failure class `grader`
in a separate envelope. `rsi-protocol-contrast-recovery.mjs` takes the frozen
source checkout through `--root`; its collector and task inputs remain bound
to that checkout. Recovery uses the same ledger, and retained responses import
without another provider request. Its `check` command recomputes the recovered
report and paired statistics.

`--recover-undispatched` admits only an ENOSPC workspace failure with zero
provider calls and no provider attempt. It writes a separate first-attempt
receipt after the campaign in original slot order, preserves the original
environment failure, and counts its requests in the same authorization.

A measured candidate cannot edit its evaluator, graders, held-out split, task
set, evidence generator, approval semantics, permissions, product locks or
defaults. This repair is evaluator-owned and prospective. Applying v2 to old
trials is labelled diagnostic reanalysis and cannot retrospectively promote them.

Prompt research candidates use one explicit evaluation switch and retain exact
off-state rollback. Product candidates remain default-off and require the separate
promotion decision. Feedback weighting remains an independent
proposed study requiring a frozen protocol, budget and rollback; this change
introduces no weights or product flag.

Closed Task Forest experiments identify historical commits and retained
evidence; they do not imply a live product loop. `liveReady=false`,
`productApproved=false`, `defaultOn=false`, `releaseApproved=false` and
`completeRsiImplementation=false` remain the boundary. Automated artefacts name
an agent actor and never claim real-human evidence.
