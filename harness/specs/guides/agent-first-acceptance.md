---
id: agent-first-acceptance
title: Agent-First Acceptance System
type: guide
appliesTo:
  - all
---

# Agent-First Acceptance System

Status: proposed
Owner policy: the repository owner supplies no first-line manual acceptance.
Evidence mode: machine-executable, agent-driven, reproducibly retained.
Product release authority: unchanged; publishing still needs a publisher decision.

This guide defines how ClawX decides whether an agent, a change to its harness, or a
release candidate has been accepted. It composes established software-testing practice,
engineering evidence methods, and modern agent evaluation practice. It is one contract,
not a collection of unrelated checklists.

The normative entry points remain:

- `harness/specs/tasks/product-acceptance-closeout.md` for Windows product readiness;
- `harness/specs/rules/agent-engineering-acceptance-boundary.md` for independent engineering
  execution;
- `harness/specs/guides/product-acceptance-strategy.md` for evidence levels and product
  shortfalls;
- this guide for agent-task validity, trajectory evaluation, stochastic trials, surrogate
  review, and the mapping of all these methods into one verdict.

A task that touches runtime communication still needs its own Harness task spec and the
selected communication profile. This guide adds acceptance semantics; it does not replace
task ownership, required rules, `diffBase`, or the frozen product locks.

## 1. What "accepted" means

Acceptance is a set of separate claims, each backed by evidence at exactly the claimed
scope:

| Claim | Question answered | Minimum evidence |
| --- | --- | --- |
| Source | Is the implementation present and contract-aligned? | Source anchors, contract checks, diff ownership and clean static checks |
| Engineering | Does the committed candidate reproduce its required builds, tests and contracts in isolated worktrees? | Two different agent roles, two detached worktrees, the same rederived manifest, raw logs, exit codes, parsed counts and hashes |
| Runtime | Does the real application path consume the change? | Real Electron/Gateway process receipts and post-action state |
| Effect | Did the user-visible journey reach its requested end state and recover/undo correctly? | Final-state oracle from the product, negative control, rollback or recovery receipt |
| Distribution | Does the frozen package, after install, retain the same contract? | Artifact identity, installed-layout receipt, post-install readback and uninstall/rollback evidence |
| Operational | Can the system be run, diagnosed, recovered and stopped? | Repeated OAT drills, bounded cleanup, diagnostics and measured failure handling |
| Agent quality | Does the model plus harness complete valid tasks reliably, efficiently and safely? | Trial suite, deterministic outcome graders, trace checks, calibrated model rubric, uncertainty bounds and residual risk |
| Publisher approval | May a finished artifact be published? | A separate publisher decision; never inferred from any automated gate |

A lower claim never proves a higher claim. In particular:

- green unit tests do not prove a runtime effect;
- a fluent final response does not prove an action happened;
- an agent's self-review is not independent verification;
- an LLM judge cannot override a deterministic failure;
- a source build is not an installed artifact;
- engineering acceptance is not product approval or real-human evidence.

The final verdict reports all dimensions. A single `accepted` label is prohibited.

## 2. Acceptance model

Every run uses the same logical record:

```text
candidate
  + task/eval specification
  + environment and resource envelope
  + deterministic preconditions
  + trials and interventions
  + multiple graders
  + final state and rollback state
  + statistical aggregation
  + independent agent review
  + residual-risk ledger
= dimension-specific verdict
```

The manifest binds:

- repository and candidate commit/tree, comparison base and changed paths;
- candidate dirty state and any retained unrelated changes;
- application, Electron, Node, runtime, model, provider and adapter identities;
- task-spec, rule, lock, fixture, test and grader digests;
- CPU, memory, disk, network, time and process limits; tool and model retry budgets;
- random seeds, trial counts, test skip budgets and timeouts;
- experiment owner, executor, verifier and model-judge actors;
- output root, retention plan and every expected artifact.

A run is invalid when any bound input changes before evidence is sealed, when an actor
identity is duplicated to fake independence, when an environment identity is omitted, or
when a pass relies on an untracked input.

## 3. The layered gate matrix

### 3.1 Static and contract layer

Run formatting, lint, typecheck, schema checks, dependency and license policy, secret scan,
static security analysis, API/contract drift checks, migration checks and requirement-to-test
traceability. A static analyzer reports candidates for defects; its findings need a policy
that says which classes block.

Exit criteria:

- zero declared blocker findings;
- all changed paths have an owning task spec;
- every checked requirement names a test or explicit `not-run`/`accepted-shortfall`;
- generated schemas and client/backend contracts agree;
- source and lock digests are recorded.

Negative controls: delete a required contract, create an unowned path, inject a secret-shaped
fixture, change a schema without its consumer, or make a test assertion vacuous. Each must fail.

### 3.2 Unit, property and mutation layer

Use example tests for named behavior, property-based tests for invariants and generated edge
cases, and mutation testing to test the tests. Mutation testing is sampled or scheduled for
large suites; it is required for high-risk parsers, authority decisions, state machines and
security boundaries once the relevant test set is stable.

Randomized tests use fixed seeds. A newly found counterexample is reduced and promoted to a
stable regression case. Coverage percentage is a diagnostic, not the acceptance oracle.

Exit criteria:

- declared happy, failure, cancel, timeout, retry and idempotency cases pass;
- no unexpected skip;
- critical invariants are present;
- mutation score meets the risk-tier threshold on the selected scope;
- every accepted bug has a reproducing test or an evidence-backed exemption.

### 3.3 Integration, contract and compatibility layer

Exercise real boundaries rather than mocks where a mock would erase the risk: renderer to
Main to host API, Gateway transport selection, schema versions, process lifecycles, plugin
and provider envelopes. Run back-to-back compatibility where a protocol has two implementations.

Contract tests may use a consumer-driven shape, but every declared response, error,
cancellation and fallback must have an executable example. Changed communication paths also
run replay/compare and retain old/new behavior.

### 3.4 System, product and effect layer

The product journey runs in the real Electron application against the real local Gateway,
with deterministic fixtures and an agent-controlled UI. UI automation uses observable semantic
locators where possible. Visual assertions are acceptable only when their state can be
decided deterministically; model judging is supplemental.

Each core journey defines:

- start state and clean profile;
- user or agent task;
- expected product state changes;
- visible final-state oracle;
- at least one denial, cancel or invalid-input case;
- recovery/undo path;
- process, port, file and temporary-resource cleanup;
- screenshot, trace or video where it catches a class of UI failure that DOM state misses.

### 3.5 Distribution and operational layer

Build a frozen artifact. Verify its checksum/provenance, run it from the installed layout,
repeat the critical journey, then verify uninstall/rollback and resource cleanup. The
operational drill set covers startup failure, Gateway loss, provider timeout, cancel,
resume/restart, crash recovery, disk/write failure, diagnostic export and bounded shutdown.

Application performance is checked only against explicit budgets. Resource limits must be
reported, not silently varied. The floor is the guaranteed allowance; the hard ceiling is
separate. Calibrate a ceiling high enough to prevent infrastructure errors from dominating
the result while retaining meaningful product pressure.

### 3.6 Agent-evaluation layer

Treat an agent run as `model + harness + tools + environment`. The task, each trial, all
graders, the complete transcript and the final environment state are separate artifacts.

The suite distinguishes:

- **capability tasks**: hard, low initial pass rate, used to find headroom;
- **regression tasks**: expected to pass almost always, used to prevent backsliding;
- **negative tasks**: valid behaviors that should not trigger a tool, approval, write or
  escalation;
- **adversarial tasks**: prompt injection, malicious tool output, unsafe paths, hidden secret
  requests and grader bypass attempts;
- **recovery tasks**: cancellation, tool failure, provider loss, restart and retry;
- **efficiency tasks**: bounded tokens, turns, wall time, tool calls and cost.

A task has a reference solution where feasible, and every grader is checked against at least
one known-good solution and several known-bad or ambiguous ones. A 0% pass rate over many
trials is treated as possible task/grader breakage until proven otherwise.

## 4. Grader design

Use the strongest practical oracle:

1. Deterministic code grader: exit status, test result, file/database/API state, event receipt,
   schema, checksum or invariant.
2. Structured heuristic: required event sequence with alternatives, state-transition rules,
   resource budgets or explicit tool-use constraints.
3. Statistical grader over repeated trials: confidence interval, paired comparison, pass-over-
   trials reliability or bounded resource distributions.
4. Calibrated model rubric for qualities code cannot decide, such as explanation clarity,
   plan coherence or whether a creative alternative is acceptable.
5. A separate agent reviewer for cross-artifact consistency, unauthorized scope, evidence
   readability and residual-risk synthesis.

Model rubrics must be frozen, versioned, structured per dimension, and calibrated against a
small adjudicated fixture set. Judges return `pass`, `fail` or `unknown`; insufficient
information is `unknown`, never an inferred pass. Judges cannot erase deterministic failure,
assert a real-human review, or approve publication.

The primary grading target is the outcome. Trace grading checks safety, causality, tool errors,
required evidence, policy and efficiency. Exact tool order is required only when it is a real
contract; otherwise allow valid solution paths.

## 5. Trial design and statistics

A model/harness comparison uses at least:

- the same task population, where possible paired by task;
- identical harness, tools, model version and resource envelope;
- clean isolated state per trial, with no access to previous trial history;
- repeated trials when outputs are stochastic;
- pass@k for "at least one success" questions and pass^k for "every attempt succeeds"
  questions;
- per-task and aggregate pass rates, not only a top-line mean;
- 95% confidence intervals and a recorded minimum detectable effect;
- paired differences when the same tasks are used across variants;
- separate reporting of infrastructure errors, task/grader errors and genuine agent failure;
- power analysis or an explicit statement that the suite cannot detect the desired effect.

Initial suites may use 20-50 realistic tasks drawn from prior failures. High-risk release
decisions need enough trials/task coverage that the interval is narrow enough for the stated
decision, or must report `insufficient-evidence`. Do not create statistical certainty by
silently dropping hard or infrastructure-failed trials.

A capability eval that saturates becomes a regression suite. Inspect its difficulty and
replace or add tasks when it stops differentiating meaningful behavior.

## 6. Environment and reproducibility

Every trial starts from a clean, isolated environment. History, caches, temporary files,
ports, processes and fixture databases from an earlier trial are removed or isolated.
Network access is bounded and recorded. Provider credentials are injected only for runs whose
task explicitly needs a real provider and are redacted from artifacts.

Record:

- OS/build, hardware, CPU/memory floor and ceiling, disk headroom and time limit;
- application, runtime, dependency and model versions;
- concurrency/worker count and random seeds;
- proxy/network and external-service availability;
- infrastructure failures and their reason;
- retry policy, excluded trials and their evidence.

The product path and evaluation harness must be close enough that a result means something
for production. Reports identify differences between the benchmark scaffold and the shipped
path.

## 7. Agent-driven review without fabricated humans

The repository owner does not participate in first-line acceptance. Map every formerly human
step to a labelled automation:

| Review need | Agent-driven equivalent |
| --- | --- |
| Click an approval or complete a form | Playwright/Electron automation with a final-state oracle |
| Inspect a screenshot | Deterministic visual/DOM checks plus a versioned vision/model rubric and negative fixtures |
| Reproduce a bug | Agent writes/updates a regression fixture, executes it and retains the trace |
| Decide a scenario verdict | Independent verifier plus deterministic graders; model rubric only for declared qualitative dimensions |
| Review test quality | Mutation/property checks, grader self-tests and a separate adversarial reviewer |
| Review logs and transcripts | Agent transcript auditor against a structured taxonomy and evidence-linked findings |
| Test real provider/channel behavior | Agent-driven local endpoint or supplied provider resource, with request/tool/effect lineage |
| Approve a release | Out of scope for acceptance: a publisher decision remains separate |

Every automation artifact carries `driven_by: agent` and a concrete actor. The evidence may
say "agent-driven product review", never "real-human acceptance". The requirement for human
evidence is removed; the prohibition against fabricating it remains.

## 8. Negative controls and anti-gaming

At least one negative control exists for each critical oracle. Required examples:

- missing/tampered evidence, manifest or hash;
- skipped/timed-out/omitted gate;
- same actor performing executor and verifier roles;
- stale candidate or changed source after planning;
- expected final state reported in text while the real state is wrong;
- an agent bypassing approval, writing an unauthorized path or reading another trial's state;
- a hard-coded response that should be rejected by hidden/held-out variants;
- a model judge that passes an ambiguous or unavailable-evidence case;
- a resource-starved run whose infrastructure failures are mislabeled as agent failures;
- a cleanup that leaves processes, ports or sensitive files behind.

Task prompts and rubrics are split into public development cases and held-out acceptance variants
where contamination would matter. The purpose is not to create security through secrecy; it is
to test generalization and detect overfitting to a fixed answer.

## 9. Evidence contract

Each run has a unique ignored raw directory and a curated tracked projection where required.
The final evidence pack contains:

```text
manifest.json
plan.json
environment.json
trials/<trial-id>/task.json
trials/<trial-id>/trace.jsonl
trials/<trial-id>/graders.json
trials/<trial-id>/final-state.json
trials/<trial-id>/stdout.log
trials/<trial-id>/stderr.log
aggregate.json
review.json
residuals.json
SHA256SUMS
credential-scan.json
```

Minimum fields per gate/trial:

- run identity, actor, role, time and execution environment;
- command/input identity and exact argv;
- exit status, timeout, duration and test counts;
- expected and actual final state;
- trace reference and tool-error count;
- grader versions, verdicts, reasons and whether each model verdict was calibrated;
- unexpected skip, retry, infrastructure error and exclusion status;
- resource consumption and bounded cleanup;
- artifact path and hash;
- limitations and residual owner/review date.

Raw logs must remain reparseable. Rehashing cannot turn a contradictory report into a pass.
The verifier reads artifacts from disk rather than trusting stdout, and confirms every cited
path and digest.

## 10. Verdict and thresholds

Each dimension ends in exactly one of:

`pass`, `partial`, `not-run`, `accepted-shortfall`, `fail`, `invalid`.

Rules:

- `pass`: all required criteria observed on the current candidate with valid evidence;
- `partial`: useful evidence exists but at least one required criterion is incomplete;
- `not-run`: no valid current-candidate evidence;
- `accepted-shortfall`: a noncritical, evidenced, reproducible, reversible residual with an
  agent owner and review date, not a disguised pass;
- `fail`: the observed behavior violates a required criterion;
- `invalid`: the run violated isolation, provenance, actor independence, statistics or
  environment constraints, so its result cannot be used.

Critical gates are binary. A weighted score may summarize quality/efficiency, but it cannot
offset a missing gate, security breach, required test failure or wrong final state.

The final report separately states:

```text
sourceAcceptedByAgent
engineeringAcceptedByAgent
runtimeAcceptedByAgent
effectAcceptedByAgent
distributionAcceptedByAgent
operationalAcceptedByAgent
agentQualityAcceptedByAgent
releaseApproved
liveReady
productApproved
defaultOn
```

No automated result changes the last four. `releaseApproved` belongs to the publisher; the
other product locks stay frozen unless a separate authorized product decision changes them.

## 11. Required workflows

### Development loop

1. Select the owning task spec and run `pnpm harness context`.
2. State the user-visible outcome, risk tier, oracle and contrary case before editing.
3. Write the smallest regression for the root cause.
4. Run focused tests, lint, typecheck and relevant contract checks.
5. For UI, run a real Electron journey and preserve its trace/screenshot.
6. For communication, run replay/compare.
7. Record development evidence as development-only; do not call it formal acceptance.

### Candidate acceptance loop

1. Freeze a clean candidate and explicit diff base.
2. Generate the plan from the task spec and changed paths.
3. Run the executor in a detached worktree.
4. Independently rederive and rerun every gate in a second verifier worktree.
5. Run product and eval trials on the real production path, with negative controls.
6. Read logs and traces back from disk; recompute counts, hashes and statistics.
7. Produce dimension verdicts and residuals.
8. Seal the evidence; only then may the Task Forest node advance.

If source, inputs or environment change, stale evidence is invalid. Focused debugging can
continue, but formal acceptance starts again on the next frozen candidate.

### Product release-candidate loop

1. Generate the requirement-to-gate and risk matrices.
2. Run source/engineering gates.
3. Run real runtime and product effect journeys.
4. Package, verify provenance, install/run and test recovery.
5. Run OAT and repeated high-risk journeys.
6. Synthesize functional, distribution and operational readiness separately.
7. Preserve the verdict and shortfall ledger.
8. Wait for no human acceptance step; the agent completes the review. Publishing remains a
   separate publisher action.

## 12. Metrics

Report metrics by dimension and never collapse them into a single health number.

Quality/correctness:

- required outcome pass rate and confidence interval;
- pass^k regression reliability;
- negative-case and adversarial-case pass rate;
- final-state mismatch count;
- unauthorized-action count (target zero);
- grader self-test and mutation score;
- unexpected skips and infrastructure failures.

Efficiency:

- wall time, time to first/visible response, turn count;
- input/output/cache tokens and cost;
- tool-call count, repeated calls and tool-error rate;
- recovery time and resources released.

Evidence quality:

- evidence freshness and hash validity;
- trace completeness and linkability;
- number of unclassified failures;
- residual age and owner;
- review agreement between independent agents and calibrated rubrics.

Thresholds are risk-tiered. A P0/P1 correctness or safety gate has no aggregate-score waiver.

## 13. Interpretation and residual risk

A report must state what was not tested: other platforms, providers, models, channel types,
permissions, network conditions, long soaks and subjective qualities. Passing the current
matrix proves those exact dimensions only.

When a model judge and deterministic grader disagree, the deterministic final state controls
the outcome; the disagreement becomes a grader-quality finding. When repeated trials produce
infrastructure errors, classify them separately and fix the environment before making a
capability claim. When evidence is incomplete, return `partial`, `not-run` or `invalid` rather
than extrapolating.

## 14. External provenance

Research provenance is retained in
`harness/specs/fixtures/agent-first-acceptance/sources.json`. The main sources are:

- ISO/IEC/IEEE 29119: risk-based testing, test levels, test basis, oracles and evidence;
- ISTQB: acceptance forms, entry/exit criteria and risk-based prioritization;
- Playwright: deterministic Electron setup, test isolation and observable assertions;
- OWASP and OpenSSF: security, dependency, artifact and CI controls;
- Anthropic, "Demystifying evals for AI agents" (2026-01-09): tasks, trials, graders,
  transcripts, final outcomes and balanced capability/regression suites;
- Anthropic, "Quantifying infrastructure noise in agentic coding evals" (2026-02-05):
  environment/resources as part of the test and resource floor/ceiling calibration;
- Anthropic, "Harness design for long-running application development" (2026-03-24):
  planner/generator/evaluator roles, sprint contracts, file handoffs and end-to-end evaluator;
- Anthropic, "Effective harnesses for long-running agents" (2025-11-26): incremental progress,
  durable artifacts, cross-session handoff and end-to-end self-verification;
- Anthropic, "Designing AI resistant technical evaluations" (2026-01-21): realistic,
  high-signal, broad-distribution tasks rather than one-insight puzzles;
- Anthropic, "A statistical approach to model evals": repeated samples, paired differences,
  confidence intervals and power analysis.

External practice informs the design. Repository rules and frozen product boundaries remain
authoritative.

## 15. Task Forest execution graph

- TF-0588 root: overall agent-first acceptance objective.
- TF-0589: contract, traceability matrix and static validation; the only initially ready node.
- TF-0590: valid tasks, reference solutions and grader calibration.
- TF-0591: agent-driven Electron interaction and final product state.
- TF-0592: resource fingerprint, repeated trials and statistical adjudication.
- TF-0593: transcript, security and qualitative rubric review by an independent agent.
- TF-0594: package, OAT and long-running recovery.
- TF-0595: independent adjudicator, evidence pack and cross-session resumability.
- TF-0596: integration with the existing Windows acceptance mainline.

The dependency graph is serial where evidence must mature, while semantically independent preparation nodes share the contract prerequisite. No node may use a human verdict or human-provided data as an open condition.

For the first implementation node (TF-0589), acceptance is complete only after the contract files are tracked as a coherent change set, the focused harness/document tests and repository-artifact gate pass, the spec validation and dry-run pass, and an independent agent reads the files and the retained output from disk. Task Forest status changes only through a proposal applied after that evidence chain is complete.
