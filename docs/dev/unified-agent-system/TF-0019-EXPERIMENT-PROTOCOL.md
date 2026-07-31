# TF-0019 UAS-08 Experiment Protocol

## Status And Authority Boundary

**等待 TF-0017 real cohort 解阻后方可执行。**

This is a pre-registered engineering framework, not an experiment result. It does not constitute real cohort, actual provider cost, tool-round, human recovery, soak, ROI, graduation, product-approval, or Task Forest evidence.

TF-0019 cannot engineer around a 14-28 calendar-day soak. Do not run `uas:06:real-canary` under this protocol until TF-0017 is unblocked and its real-cohort evidence is reviewed. This protocol does not authorize a TF-0006 change, frozen-lock change, automatic default-on, or Task Forest node transition.

It must not be used to infer human review, actual provider cost, soak, ROI, `liveReady`, `productApproved`, or `defaultOn` from engineering tooling.

## Preconditions

Before the first pilot task, an accountable operator and product owner must approve a reviewed TF-0017 real-cohort report, bounded internal cohort, rollback window, named incident contact, operator-controlled kill path, stable pinned provider/model/runtime/config baseline, and one approved task definition per pair.

Each pair requires a unique `pairedTaskId`, serial arm execution, distinct sessions, retained low-sensitivity provenance, and locked values for non-inferiority margins, confidence level, power, pilot size, formal sample size, timeout, and escalation threshold. No placeholder in this document is permission to execute a live task.

## Paired A/B Design

| Arm | Required host | Pairing rule |
| --- | --- | --- |
| Baseline | `host=gateway` | Shares one `pairedTaskId` with its VerseShell counterpart. |
| VerseShell | `host=verseshell` | Shares one `pairedTaskId` with its baseline counterpart. |

Randomize arm order within each stratum before execution. Host choice is operator-owned; it must not be a model-selected or per-call fallback decision. Record every fallback, retry, abort, timeout, and recovery action. A pair with missing actual provider receipt, task result, or human-recovery record is not eligible for primary-metric analysis.

## Primary Metrics And Provenance

| Metric | Definition | Authoritative provenance |
| --- | --- | --- |
| Provider token cost (USD) | Actual billed or receipted provider token cost for the task. | Provider receipt or billing export; never VToken or an estimated token heuristic. |
| Tool round count | Count of completed tool invocation rounds attributed to the task. | Trace/diagnostic event sequence with task and arm linkage. |
| Human recovery minutes | Operator minutes spent returning a failed, degraded, or ambiguous task to a safe state. | Dated operator log and reviewer attestation. |

Store raw prompts, commands, transcripts, outputs, environment values, approval tokens, credentials, and provider receipt bodies outside this repo. Repository evidence may retain only approved opaque references, SHA-256 digests, provider/model identity, exact usage fields, and reviewer attestations. Every primary metric needs a traceable pair, arm, task result, and provenance reference; coverage must be reported as a denominator, not assumed.

## Non-Inferiority And Sample Size

Before a pilot begins, the operator and product owner must pre-register a relative-baseline non-inferiority margin for each primary metric. The values are intentionally not invented by this blocked framework. Lock them before the first pilot result is inspected.

| Metric | Margin | Analysis method | Decision rule |
| --- | --- | --- | --- |
| Provider token cost (USD) | `TO_BE_LOCKED_FROM_PILOT` | Paired difference with a pre-registered one-sided confidence interval. | Upper bound must not exceed the locked margin. |
| Tool round count | `TO_BE_LOCKED_FROM_PILOT` | Paired difference with the same pre-registered interval method. | Upper bound must not exceed the locked margin. |
| Human recovery minutes | `TO_BE_LOCKED_FROM_PILOT` | Paired difference with the same pre-registered interval method. | Upper bound must not exceed the locked margin. |

Run a bounded pilot to estimate paired-difference variance and missing-data rate. Then calculate the formal paired sample size from the locked margin, confidence level, target power, and pilot variance. Record the formula, inputs, rounding rule, attrition allowance, and resulting `n` before formal data collection. Pilot values are not formal results and must not be presented as ROI, soak, or graduation evidence.

## Stratification

Report pooled results and every non-empty stratum. A pooled result cannot hide a critical-stratum regression.

- Start state: cold and warm.
- Execution mode: foreground and background.
- Task type: coding, debug, and exploration.

The registration must specify the stratum before a task's first arm runs. An unclassifiable task is reported separately and excluded from a stratum-specific conclusion unless the signed analysis plan says otherwise.

## Safety Zero-Observation Strategy

Zero observed incidents is an observation, not proof of zero risk. For each arm and pooled exposure, report the incident definition and severity taxonomy; completed-task exposure denominator; excluded and unknown exposure; observed event and veto counts; stress-test scenarios and results; confidence level and method; exact upper bound for the event rate; evidence completeness; and reviewer identity.

For zero events, an exact one-sided upper bound can use `1 - alpha^(1 / n)` for locked `alpha` and exposure `n`. The report must distinguish `zero observed`, `not observed`, `not applicable`, and `missing`. Pressure testing complements live observations; it cannot substitute for a real cohort or claim GA.

## Timeout, Stop, And Soak Rules

Before pilot execution, derive and lock a single-task timeout and the threshold at which repeated timeouts force a stop/review. A timeout aborts the task, records recovery work, and enters the next daily checkpoint; it is never silently retried into a different arm.

The soak is continuous calendar time: **14-28 days is calendar soak, not active engineering time.** Lock the minimum duration, maximum decision window, daily checkpoint time, allowed maintenance interruption, and continuity rule before the first soak day.

Every daily checkpoint verifies date continuity and both-arm coverage; pair/task/result/provider-receipt provenance completeness; timeout, recovery, safety-event, and veto status; drift against every locked cost, tool-round, and recovery margin; missing evidence; retry/fallback behavior; and rollback actions.

Hard NO-GO conditions are a safety veto, provider-cost worsening beyond its locked stop margin, human-recovery worsening beyond its locked stop margin, unauthorized execution/authority change, implicit native fallback, or replacing actual provider usage with a VToken heuristic. A hard NO-GO stops expansion and requires an owner-reviewed `stop` decision.

## Analysis And Decision

The graduation template is the only place that records the owner decision. It must reference actual source evidence and must not alter product defaults or Task Forest state by itself.

`continue` is eligible only after reproducible paired A/B evidence, complete actual-provider/task/recovery provenance, continuous 14-28 calendar-day soak, zero hard vetoes, an accepted zero-observation/stress/upper-bound report, all locked non-inferiority conditions, and stable improvement in at least one primary metric without a critical-metric deterioration.

`reduce` is the non-hard-stop outcome for insufficient or inconclusive sample, unresolved confidence interval, or benefit limited to a narrower stratum. It must name the reduced scope, safeguards, remediation, and next data plan.

`stop` is required for a hard NO-GO and records containment, rollback, evidence preservation, and the owner decision. Neither `continue` nor `reduce` is automatic graduation, GA, default-on, or TF-0006 evidence.

## Evidence Integrity Checklist

- Do not fabricate any real evidence.
- Do not use a synthetic benchmark to claim GA.
- Do not infer cost from VToken heuristics.
- Do not modify frozen locks, close TF-0019, or automatically modify TF-0006.
- Preserve raw sensitive evidence outside the repository and record only approved low-sensitivity provenance here.
