---
id: product-acceptance-strategy
title: Product acceptance strategy, exit criteria and shortfall acceptance
type: guide
appliesTo:
  - all
touchedAreas:
  - harness/specs/guides/product-acceptance-strategy.md
  - harness/specs/fixtures/product-acceptance-shortfalls/**
  - docs/README.md
  - tests/unit/product-acceptance-shortfalls.test.ts
---

# Product acceptance strategy (GA readiness)

This guide answers one question: *when may this repository claim that a surface is
GA-ready, and how does it record the gaps it deliberately accepts?*

It complements — it does not replace — `docs/dev/first-product-controlled-preview/DEFINITION-OF-DONE.md`
(G1–G5), `harness/specs/rules/agent-engineering-acceptance-boundary.md` (independent
verification), `harness/specs/tasks/harness-codex-active-verification.md` (evidence
grades and freshness) and `docs/dev/default-config-matrix.md` (product locks).

Research provenance for the external practices and tool candidates is retained in
`harness/specs/fixtures/product-acceptance-research/` (`sources.json` and
`research-report.json`; Exa Contents request
`8b5571293252b541db3128c4129513f7`, 2026-10-27; all ten requested sources succeeded).

Primary references consulted:

- ISO/IEC/IEEE 29119 testing process series: https://committee.iso.org/ (official committee landing).
- [ISTQB risk-based testing](https://istqb-glossary.page/topics/risk-based-testing/).
- [Playwright best practices](https://playwright.dev/docs/best-practices) and
  [Electron automation](https://playwright.dev/docs/api/class-electron).
- [OSWorld execution-based evaluation](https://arxiv.org/html/2404.07972) and
  [WindowsAgentArena](https://arxiv.org/html/2409.08264).
- [Midscene.js vision-driven UI automation](https://midscenejs.com/basics).
- [fast-check](https://fast-check.dev/docs/introduction/what-is-property-based-testing/) and
  [StrykerJS mutation testing](https://stryker-mutator.io/docs/).
- [LLM evaluator best practices](https://arize.com/docs/ax/concepts/evaluators/evaluator-best-practices).
- [OpenAI computer-use browser and desktop drivers](https://developers.openai.com/api/docs/guides/tools-computer-use-sdk-drivers).

External practice is used as reference, not as authority: ISO/IEC/IEEE 29119 (test
processes, documentation and techniques), ISTQB CT-AcT (acceptance-testing forms),
operational acceptance testing (OAT), session-based exploratory testing, DORA-style
delivery/stability metrics and WCAG/axe-guided accessibility checks. Where an external
practice conflicts with a repository rule or product lock, the repository rule wins.

## 1. Acceptance levels

Each level is a distinct claim. A lower level is never promoted to justify a higher one.

| Level | Claim | Minimum evidence | Explicitly not proven |
| --- | --- | --- | --- |
| L0 `source` | The implementation exists and is reviewed | Source anchors with `path:line`, contract check, `git diff --check` | Anything about runtime behavior |
| L1 `automated` | Unit/integration suites cover happy, failure and kill paths | Command, exit code, parsed counts, skip budget | Real process behavior; product usability |
| L2 `runtime` | The change takes effect in real Electron + real Gateway child | Real-process receipt, acknowledgement readback, flag-off baseline parity, counter/lineage | Packaged build; broad platform coverage; human usability |
| L3 `effect` | The user-visible outcome is reached and reversible | End-to-end journey in the product surface, negative and rollback/undo cases, screenshots or receipts | Other operating systems; provider quality; long-duration stability |
| L4 `packaged` | The frozen artifact reaches the same behavior after packaging/install | Artifact SHA256, install-state run, post-install readback, uninstall/rollback check | Standing release approval |
| L5 `operational` | The system is operable: recovery, resource reclamation, diagnostics, support path | OAT set below, repeated runs, MTTR-style measurements, failure drill receipts | Real-user acceptance |
| L6 `release-approved` | The owner decided to publish | Explicit owner decision record plus product-lock change | — (terminal, owner-only) |

Rules:

1. Evidence carries exactly one level; a mixed claim is split per assertion.
2. Freshness is mechanical. Changing any source, spec or package input invalidates the
   affected receipt rather than demoting it quietly.
3. `partial`, `not-run` and `unverified` stay visible. They are legitimate results, not
   failures to be relabeled.
4. L6 requires the owner. No automated gate in this repository can produce it, and
   `task-forest-autoclose-and-roles.md` keeps publication outside agent authority.

## 2. Required acceptance dimensions

Every release-candidate review covers these dimensions. Each row must end as
`pass`, `partial`, `not-run` or `accepted-shortfall` — never blank.

| Dimension | What it covers | Representative evidence |
| --- | --- | --- |
| Functional | Named user journeys per surface: chat, sessions, workspace/coding, memory, knowledge, multi-agent, channels, scheduling | Playwright journeys, gateway receipts, transcript readback |
| Failure handling | Explicit, legible failures: provider outage, timeout, permission denial, interrupted run | Negative-path suites, recovery receipts |
| Recovery/rollback | Undo, write journal, checkpoint/resume, revert, resource reclamation | Journal `remainingEntries`, restart journeys |
| Operational | Startup/shutdown, process reclamation, ports, disk/ACL assumptions, diagnostics/Doctor | Cleanup ledgers, OAT drill logs |
| Non-functional | Latency, resource ceilings, stability across repeated runs | Timing reports, RSS/owner-count measurements, flake window |
| Security/privacy | Local-data boundaries, credential hygiene, private-network default, approval path | Security suite, credential scan, fail-closed tests |
| Accessibility/UI | Keyboard path, focus/contrast, accessible names, visible state changes | axe-based scans (partial by design) plus keyboard/tooltip screenshots |
| Compatibility | Windows x64 primary; other platforms declared separately | Per-platform receipts or explicit not-run |
| Documentation truth | README/docs match implementation; locks unchanged unless decided | README status lines, capability-claims status table, docs policy check |

## 3. Exit criteria

Exit criteria are numeric and pre-declared. Current defaults, adjustable only by recording
the change before the run:

| Gate | Default threshold | Notes |
| --- | --- | --- |
| Blocking suites | 0 failed, 0 unexpected skip outside the fixed skip budget | Applies to every declared required test |
| Flake window | >= 95% pass over the last 30 runs per gate; a gate below the threshold is quarantined, not muted | Quarantine keeps the failure visible and files the fix |
| Repeated-run stability | 3 consecutive clean runs of the release-critical journey on a clean fixture | Reuse of a previous run is not a repeat |
| Untriaged defects | 0 open P0/P1 at exit; P2 accepted only with owner-visible shortfall ID | Cosmetic backlog never blocks, security/crash always blocks |
| Rollback rehearsal | Last rehearsal passed and stays reproducible | Rollback is a release criterion, not an incident-time hope |
| Performance | No > 10% regression in declared SLI vs. recorded baseline, or an accepted shortfall with a review date | Unmeasured is `not-run`, not pass |
| Evidence freshness | Every cited artifact resolves and matches its SHA256 | Stale evidence fails closed |
| Burden | Every `not-run` row has an owner and a review date | A row without owner+date is an incomplete review |

## 4. Shortfall acceptance

Not every gap must be closed before a GA candidate is declared. It must be *recorded*.

The machine-readable ledger lives at
`harness/specs/fixtures/product-acceptance-shortfalls/ledger.json`. Rules:

1. Each entry has: `id`, `surface`, `level` (highest proven level), `dimension`,
   `gap`, `evidence`, `impact`, `owner`, `reportedAt`, `reviewBy`, `status`.
2. `status` is `open`, `in-progress` or `resolved`. Accepted gaps stay `open` with a
   `reviewBy` date; closing requires evidence, never prose.
3. A shortfall may never be written as `pass`, and its level may not be inflated.
4. No shortfall may suppress a blocking failure. Blocking failures are defects, not gaps.
5. Blast radius and rollback time decide how much risk a gap may carry: a gap whose
   false-pass can be caught and reverted quickly is more acceptable than one that
   silently corrupts durable user data.
6. An accepted shortfall must name the impact, reproduction evidence, failing oracle,
   rollback/kill switch, agent owner, review date, monitoring and quarantine rule. If any
   item is missing, the dimension is `unverified` rather than `accepted-shortfall`.
7. A blocking failure, unresolved P0/P1, current-candidate critical journey without an effect
   receipt, tracked/user-data mutation, or stale release evidence cannot be accepted as a gap.
8. The five baseline gaps (`runtime-memory-retired-test-contract`,
   `coding-loop-e2e-final-response`, `e2e-skill-source-mutation`,
   `agent-acceptance-harness-unconfigured-test-dirs`, `qa-lab-scenario-pack-not-present`)
   are recorded with concrete evidence pointers and re-review dates. Three are resolved with
   current-candidate evidence; the remaining rows are the acceptance backlog, not an excuse
   for silence.

## 5. Agent-driven equivalent of human acceptance

Per the repository owner policy (`AGENTS.md` §Human-in-the-loop), human steps are replaced
by automated agent-driven equivalents and labeled as such — never as real-human evidence.

Mapping from human testing forms to agent-driven equivalents:

| Human form | Agent-driven equivalent | Evidence produced | Honest limits |
| --- | --- | --- | --- |
| UAT by product owner | Agent executes the user journey with the real built app and a real provider or scripted provider | Journey transcript, screenshots, receipt, verdict | Does not prove human preference or comprehension |
| Alpha testing (in-house) | Agent runs the journey suite on the candidate in a clean profile | Repeat-run results, defects found | Not independent of implementation agent if the same agent wrote the code |
| Beta testing (external users) | Bounded canary executed by an agent identity on a labeled fixture | Canary report, rollback proof | Not real users, not public feedback |
| Operational acceptance (OAT) | Agent runs the OAT drill list: restart, kill, disk/ACL change, port conflict, backup/restore, resource reclamation | Drill receipts with before/after counts | Does not prove long-term operational reliability |
| Exploratory/session-based testing | Agent runs a time-boxed charter session with note-taker and debrief | Charter, timeline, debrief, found defects | Agent anomaly-attribution quality remains limited |
| Accessibility (manual WCAG review) | axe-core scan plus keyboard/focus/contrast walk-through script, screenshots captured | Scan JSON with violation list, keyboard screenshots | Automation covers a minority of WCAG criteria |
| Performance/latency acceptance | Agent-driven repeated measurement with recorded baseline, warm/cold distinction | Timing report, percentiles, regression delta | Machine-dependent; not multi-machine evidence |

Cross-check requirements (adapted from agentic-testing research):

- Tests derive from requirements or product semantics, not from the code under test.
- The generation agent and the verdict agent are separately identified.
- The run produces an execution record that the generation agent cannot silently edit.
- The report states coverage **and** remaining gaps; "all green" alone is not a verdict.
- Three repeat runs and at least one negative case are the floor for a browser/GUI agent
  claim; step-level screenshots or traces accompany failures.

### 5.1 Layered test strategy

The acceptance suite is risk-based. It uses the lowest-cost oracle that can prove the
claim and promotes a claim only after the layer above it passes. Coverage percentage
alone is not an exit criterion; the critical user journeys, failure branches,
permission boundaries and final durable state must each have an explicit oracle.

| Layer | Purpose | Primary oracle | ClawX application |
| --- | --- | --- | --- |
| Static and contract | Reject invalid source, schemas and stale documentation | Compiler, schema validator, policy checker, source/test traceability | `typecheck`, contract, i18n, catalog, Harness and docs-policy checks |
| Unit | Fast behaviour and edge-case coverage | Exact assertions, property invariants, parser tests | 1001 unit files plus runtime-specific suites |
| Integration | Cross-module contracts without the full desktop shell | Typed API responses, persisted records, failure injection | Host API, Gateway, Task Ledger, memory, channel and persistence tests |
| Component UI | Isolate renderer behaviour with deterministic host responses | DOM/ARIA assertions, mocked state, snapshots | Renderer E2E and visual regression |
| System E2E | Exercise the real Electron process, Gateway child, storage and tools | Final files/DB state, process ledger, user-visible readback | 189 Electron E2E specs and packaged-flow probes |
| Operational acceptance | Prove restart, crash, outage, recovery, cleanup and supportability | Before/after process/resource counts, drill receipts | OAT set in §5.4 |
| Agent exploratory | Find unexpected paths beyond declared scripts | Harness-controlled Browser/Desktop driver plus deterministic oracle | GUI Agent charter sessions in §5.3 |
| Release artifact | Prove the frozen package equals the accepted candidate | Installed-app journey, SHA256, signing and post-install readback | L4 packaged evidence and release attestations |

Higher layers use fewer, more expensive scenarios. A green lower layer does not prove a
higher-layer claim. A red lower layer blocks promotion unless the failed assertion is
shown to target a retired contract or an environment that cannot affect the claim.

For each feature, record the test matrix before execution:

| Field | Required content |
| --- | --- |
| Requirement / invariant | What must remain true, linked to a user journey or product semantic |
| Happy path | The shortest user-visible successful route |
| Boundary cases | Empty, long, non-ASCII, malformed, concurrent and maximum-budget inputs |
| Failure paths | Timeout, unavailable provider, permission denial, cancellation, stale state and partial write |
| Recovery | Retry, resume, undo, rollback, process/port/temp cleanup and durable-state verification |
| Negative oracle | A result that must be rejected; a test that cannot fail is not acceptance |
| Evidence level | One of L0–L6, plus command, input, output, count and artifact hash |

### 5.2 Primary oracle and judge hierarchy

Use this precedence when evidence conflicts:

1. Deterministic product state: files, SQLite/JSON records, event logs, Task Ledger and journal
   contents after the journey.
2. Deterministic process/system state: exit code, child-process tree, ports, resource caps,
   permissions and cleanup ledgers.
3. Typed API and UI assertions: Host API/Gateway response schema, DOM/ARIA state and visible
   text at the asserted step.
4. Screenshot, trace and video evidence: useful for attribution and diagnosis; not a pass oracle
   unless a declared visual invariant has an approved baseline or region-aware verifier.
5. Independent evaluator Agent using a versioned rubric: allowed for semantic and exploratory
   dimensions, never used to overturn failed deterministic evidence.

An evaluator may return only `pass`, `fail` or `unverified`, with a criterion-specific reason;
a holistic 1–5 score is not a gate. A GUI Agent is an actor, not an oracle. It may operate the
app, but the harness must read back durable state and execute at least one negative path.

Before treating an evaluator as stable, compare it with a labeled golden set. Start with
20–100 cases spanning pass/fail boundaries, measure agreement and false-pass rate, and retain
the rubric/version. This uses the same validation discipline as LLM-as-judge guidance, but the
golden labels may be agent-authored when repository policy forbids a human prerequisite. A
low-agreement or uncalibrated evaluator remains diagnostic.

### 5.3 Agent-driven GUI acceptance runbook

Agent-driven testing should replace repetitive human operation, not the evidence standard.

| Stage | Minimum implementation |
| --- | --- |
| Freeze | Bind app build/hash, model and provider, driver, fixture, app profile and acceptance rubric |
| Isolate | Use a disposable profile and workspaces; cap network, disk and process effects; never run on user data |
| Charter | State goal, included surfaces, excluded surfaces, time/step budget and expected observable state |
| Generate | Derive scenario steps and assertions from requirements/scenarios, not from current implementation internals |
| Execute | Actor Agent interacts through visible UI or the declared Accessibility/DOM driver |
| Observe | Capture step timestamps, action, target, screenshot/trace, console/network logs and process state |
| Verify | Deterministic oracle first; a separately identified evaluator Agent may judge rubric-only criteria |
| Recover | Exercise at least one declared failure or cancellation and verify no stale run/process/resource survives |
| Repeat | Run three times on a clean fixture; quarantine flaky scenarios rather than weakening assertions |
| Retain | Store a redacted run manifest, traces, failure bundles, oracle results and a source-freshness digest |

A GUI result has two scores: `taskSuccess` (did the declared final state occur) and
`trajectorySafety` (were permissions, cancellation, scope, latency/cost and recovery respected).
Do not report only a composite score. `taskSuccess=true` with an unsafe trajectory is a failure.
Use a provider-native structured driver when the app can expose DOM/Accessibility state; reserve
pixel/coordinate operation for interfaces that cannot be controlled structurally. This mirrors
the OSWorld/WindowsAgentArena split between high-level tasks and execution-based final-state
evaluation, and OpenAI's distinction between browser and screenshot-based computer drivers.

Suggested tools are optional adapters, not a second product authority:

- Playwright remains the primary desktop harness.
- Midscene.js or a CUA/Browser-use style driver may provide natural-language exploration or
  coordinate operation.
- `axe-core` supplies accessibility rules; keyboard/focus/contrast checks remain separate.
- Fast-check and StrykerJS add generative edge cases and test-oracle mutation scoring.
- `pnpm acceptance:agent:full` already supplies independent Executor/Verifier runs in separate
  detached worktrees for engineering gates and should be the first integration target.

Adopt a GUI Agent tool only after a spike shows it is reproducible, can be driven headlessly in
CI, exposes step-level evidence and does not weaken permission or cleanup boundaries. Treat newly
indexed or low-authority third-party projects as candidates until their license, maintenance and
actual ClawX spike results are reviewed.

ClawX also contains two complementary local foundations that should be reused before adding a
new dependency:

- `openclaw_runtime/extensions/qa-lab` owns scenario suites, mock/live provider modes, desktop
  smokes, screenshots and run summaries.
- `pnpm acceptance:agent:full` owns clean-candidate, dual-role, detached-worktree engineering
  verification. Its `--spec` selector can bind a future product-acceptance spec without making
  this guide itself a release authority.

The intended composition is: QA Lab supplies repeatable journeys and media evidence;
Playwright/files/SQLite/event logs supply deterministic oracles; the acceptance runner supplies
independent reproduction and fail-closed aggregation. Optional third-party agents enter through
a narrow adapter behind the same run config and evidence schema.

### 5.4 Operational acceptance drills

Run and record this set once per release candidate:

1. Cold start with no prior profile, and warm start with an existing profile.
2. Gateway unavailable, provider timeout, malformed response and mid-run cancellation.
3. Restart during an active run; verify checkpoints, resume/abort state and no duplicate execution.
4. Kill the Gateway/Electron child; verify supervisor recovery and orphan-process sweep.
5. Occupy the expected port and remove/corrupt a non-critical config; verify bounded, legible failure.
6. Low-disk and unwritable-temp drill; verify task temp/artifacts use a writable local root.
7. Corrupt or abruptly remove a write-journal snapshot; verify undo fails closed and evidence remains.
8. Backup/restore the local configuration and verify a clean checkout can rebuild the accepted state.
9. Verify telemetry/support-bundle diagnostics without secrets and confirm default-redaction behavior.
10. Run a long-repeat smoke and capture process/RSS/port/temp reclamation after every cycle.

### 5.5 Current-candidate acceptance matrix

For the current `0.4.9-alpha.0` source candidate (`082836e` at review time), use this minimum matrix. It is deliberately smaller than the
whole repository test inventory and is the set that must be refreshed before a GA decision.

| Dimension | Candidate set | Pass condition | Current disposition |
| --- | --- | --- | --- |
| Functional | Setup, Chat, coding loop, Memory, Knowledge, Task Ledger, Task Loop, long-session restart | One real Electron journey per surface plus durable-state readback | partial: coding loop open |
| Cross-layer | Renderer -> host-api -> Main/Gateway -> runtime -> event back to renderer | Typed request/response plus user-visible final state | pass for sampled chat/memory |
| Failure | provider timeout/outage, permission denial, malformed response, cancellation | Explicit failure, no success-looking fallback, no duplicate run | partial: negative suites exist; consolidate |
| Recovery | abort/stop/archive/restore/delete/fork/handoff; write-journal undo; Gateway restart | Final state, checkpoint/journal evidence, no late resurrection | partial: distributed receipts exist |
| Reliability | 3 consecutive release-critical runs, 30-run flake window, bounded timeout | 95% over 30 runs; zero unexplained flake in the 3-run release journey | not-run as one candidate set |
| Performance/resources | build/typecheck/E2E timings, RSS/process/port/temp ceilings | no declared SLI regression >10%; cleanup returns to baseline | partial: individual reports exist |
| Security/privacy | approval, private-network deny, host boundary, credential scan, redaction | all negative attacks fail closed; no secret in persisted evidence | pass for sampled suites; refresh candidate |
| Accessibility/UI | keyboard, focus, names, contrast, responsive layouts, visual baselines | axe/core rules plus keyboard walk-through; no unexplained visual drift | partial: basic scan exists; use full axe candidate |
| Packaging | frozen `win-unpacked`/installer candidate | hash, installed launch, core journey, upgrade/uninstall and lock readback | not-run for this candidate because `release/` artifact is absent |
| Operations | §5.4 drills and support-bundle/Doctor path | OAT receipt with timings, failures, cleanup and rollback | partial |
| Documentation truth | README, capability claims, acceptance ledger, Task Forest/handoff | no claim exceeds evidence; no stale lock/default statement | partial: index and policy checks pass, live docs review is unverified |

The matrix is an acceptance plan, not the verdict. A row stays `not-run` until its current-candidate
artifact exists. A row becomes `accepted-shortfall` only under §4.

### 5.6 Shortfall acceptance and false-positive controls

The gap ledger separates a defect from a deliberately accepted residual. Every shortfall records
`shortfallClass`, `acceptanceDisposition`, `risk`, `dataAtRisk`, `userVisible`,
`rootCauseClass`, `blastRadius`, `repairCost` and `pathToGa`. This makes acceptance
decisions reviewable without turning a gap into a pass.

Use these false-positive and false-negative controls:

| Failure mode | Control | Gate action |
| --- | --- | --- |
| Test passes because its assertion is unreachable | Negative mutation or injected failing oracle | NO-GO until the test detects mutation |
| UI agent says success but app state is wrong | Deterministic final-state oracle / file/DB readback | Agent verdict cannot override failed state |
| Screenshot looks correct but workflow state is stale | Timestamp, event/runId and source-freshness binding | `unverified` |
| Test passes by using a shortcut or hidden fixture | Requirement-derived scenario and forbidden-path checks | NO-GO |
| Failure is labeled flaky without diagnosis | Quarantine receipt, owner, reproduction, expiry | Still visible; cannot count as pass |
| A model judge rewards vague prose | Criterion-specific rubric, fixed output labels, calibration set | `unverified` until calibrated |
| Evidence is green but from another commit/build | Candidate/tree/binary/input hashes | stale / NO-GO |
| Recovery succeeds but leaves processes/data behind | Before/after process, port, temp, journal counts | fail closed |
| Coverage rises while critical branches disappear | Journey/negative-case coverage plus mutation score | human-readable coverage review, not percentage-only |

A mock or scripted provider may prove control-flow and tool semantics; it cannot carry a
live-provider quality claim. A live-provider run proves only the recorded model/provider/input
configuration. Neither substitutes for packaged/install-state or operational evidence.

Agent-driven evidence is still stronger than a model-only self-report: the actor must leave a
replayable action timeline, and the deterministic oracle must validate the resulting product or
system state. The evaluator's prose is an attribution aid. A model-only claim of "I completed the
task" is never acceptance evidence.

### 5.7 Next implementation sequence

1. **Resolved by TF-0574:** repair Runtime Memory test-contract drift; the clean candidate focused gate is green while the full aggregate gate remains a later release gate.
2. **Resolved by TF-0575:** bind plan output roots to the explicit source root and pass the
   complete acceptance-runner focused file, including the original 74 tests and two new path
   negatives.
3. Stop Electron test startup from deleting skill source/link targets and add a worktree guard.
4. Instrument the coding-loop provider request, fix the first failing owner, and require three
   clean E2E runs with undo/readback.
5. Restore a minimal tracked QA Lab personal-agent scenario pack, run it with `mock-openai`, and
   retain one success plus one negative/recovery receipt.
6. Consolidate failure/recovery/OAT receipts into one candidate-bound run manifest.
7. Run the independent Executor/Verifier acceptance path on a clean committed candidate.
8. Package the frozen artifact and execute the same core journey from the installed layout.
9. Treat acceptance of any remaining residual as a product/scope decision: produce the
   decision proposal and automation evidence, then obtain the repository owner decision that
   R5 reserves for release scope. Refresh the ledger, Task Forest evidence and product locks
   only after that decision.

## 6. Applying this to the current GA question

Using the levels above, the present state of this repository reads as:

- Functional surface: mostly L1–L3 proven, with the coding-loop end-to-end journey
  currently blocked at L3 (see ledger `coding-loop-e2e-final-response`).
- Operational surface: partial L5; OAT drills are recorded individually but not as one
  release-candidate drill set.
- Exit criteria: not yet satisfied. The gap ledger has two open `must-resolve-before-ga`
  items: coding-loop final response and the absent QA Lab scenario pack. The Electron E2E
  source-mutation defect is resolved by TF-0576 on clean candidate `7999579a6` (42/42 focused
  tests, three launches plus app-smoke with the tracked-source guard green; evidence in
  `harness/specs/fixtures/product-acceptance-closeout/a3-source-safety/`).
  Runtime Memory retired-test drift is resolved by TF-0574 on clean candidate `07f60c029`
  (87 focused tests; evidence in `harness/specs/fixtures/product-acceptance-closeout/a1-memory/`).
  The independent acceptance-runner plan-path defect is resolved by TF-0575 on clean candidate
  `5bb7f1f53` (76/76 focused tests, original 74 preserved; evidence in
  `harness/specs/fixtures/product-acceptance-closeout/a2-runner-path/`). The current checkout
  also has no packaged release artifact, so L4 is `not-run` rather than inherited from history.
- L6: not claimed. `liveReady`, `productApproved` and `defaultOn` remain locks.

Therefore the honest current label is **GA candidate / release candidate with an
open, recorded shortfall ledger** — not GA. The distance to GA is dominated by exit-criteria
work and shortfall closure, not by missing product modules.

## 6.1 Current failure baseline (historical observations)

The following observations were captured from `D:\ClawX` before this contract was frozen.
They explain why the candidate remains a GA candidate; they are **not fresh gates** and
must not be re-quoted as current passes or failures after the candidate changes.

| Observation | Reported result | Label | Use |
| --- | --- | --- | --- |
| `tests/unit/task-loop-controller.test.ts` | 64 passed / 3 failed | historical unit baseline, 2026-10-27 | Input to `TF-0574`; no current-candidate verdict |
| Independent acceptance-runner focused file | 74 total / 72 passed / 2 failed / 0 skipped | historical runner baseline, 2026-10-27 | TF-0575 superseded this row with a clean-candidate 76/76 run; retained as provenance |
| Coding-loop E2E | 1 failed: turn did not reach final response | historical E2E baseline, 2026-10-27 | Input to `TF-0577`; no L3 effect proof |
| Full typecheck log | exit 0, including test project | historical observation only | Not a substitute for a fresh aggregate gate |

The raw logs remain under `.tmp/` for local diagnosis and are fingerprinted in the a0
evidence manifest. The retained manifest must state `currentCandidateRun: false` for these
rows. A future node may resolve a gap only with a fresh command, exit code, parsed counts,
negative control and artifact hash bound to its own candidate.

TF-0574 subsequently resolved the retired-test row on candidate `07f60c029`: the task-loop
contract file reports 69/69, the Runtime Memory context contract 8/8, and the ledger verifier
10/10. This supersedes the historical 64/3 row while preserving it as provenance. TF-0575
resolved the runner-path row on candidate `5bb7f1f53`: all original 74 test names are present
and passing, and two additional path-contract tests bring the focused file to 76/76 with zero
skips. Rejection of repository-root overwrite, in-tree `.tmp`, unrelated in-tree roots, and
`..` traversal remains covered; evidence is under
`harness/specs/fixtures/product-acceptance-closeout/a2-runner-path/`.

## 7. How to run a review

1. Pick the target release candidate and freeze its commit.
2. Generate this level table and the dimension table as a review artifact.
3. Run each declared gate; record command, exit code, parsed counts and skip budget.
4. Resolve every non-pass row to `partial`, `not-run`, `resolved` or `accepted-shortfall`.
5. Update the shortfall ledger with review dates and evidence pointers.
6. Run the operational drill set (OAT list) once per candidate.
7. Produce the verdict at the *lowest* proven level, with the gap list attached.
8. Only the repository owner may turn an L6 decision into a publication action.
