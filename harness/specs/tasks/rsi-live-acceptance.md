---
lifecycleStatus: active
id: rsi-live-acceptance
title: Run real-provider resource checks and independent RSI task admission
intent: Begin real RSI acceptance using actual space-bunny Responses calls and independently executed historical task oracles, retaining every attempt and refusing benefit measurement when reference or unresolved baseline calibration fails.
diffBase: bd677408f
touchedAreas:
  - scripts/rsi-live-acceptance.*
  - scripts/lib/rsi-live-*.mjs
  - scripts/lib/rsi-live-*.d.mts
  - scripts/lib/rsi-benefit-eval.*
  - scripts/lib/rsi-responses-provider.*
  - tests/unit/rsi-live-*.test.ts
  - tests/unit/rsi-benefit-eval.test.ts
  - tests/unit/rsi-responses-provider.test.ts
  - harness/specs/tasks/rsi-live-acceptance.md
  - harness/specs/fixtures/rsi-live-acceptance/**
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - paired-ablation-boundary
  - reliability-aggregation-boundary
expectedUserBehavior:
  - Before model-generated edits count as outcomes, the reference and unresolved baseline are independently graded.
  - Missing or stale task baselines and failing reference oracles are classified as task/grader/infrastructure problems, never model failures.
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-live-acceptance.test.ts tests/unit/rsi-live-grader.test.ts tests/unit/rsi-responses-provider.test.ts --maxWorkers=1
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/rsi-live-acceptance.md
acceptance:
  - The user authorized the supplied local Responses endpoint and space-bunny and explicitly waived a financial cap; fixed per-trial request, output and wall-clock limits still prevent unbounded loops.
  - The API key enters through stdin, is never passed to the subject or grader process and is not written to source, configuration, logs or retained evidence.
  - Current corpus identities and public/held-out membership are retained; each historical base and reference revision is recovered from its original acceptance record before execution.
  - A hard admission failure leaves model task execution and subject isolation explicitly unexecuted; endpoint preflight is never counted as a quality trial.
  - A baseline whose only failure is a missing module inside the declared target scope is admitted with `baseline-target-module-absent`; missing dependencies outside target scope remain hard failures.
  - `ready-for-measurement` requires all 24 task admissions and a retained passing provider preflight matched to the planned endpoint/model; a missing or failed preflight leaves the result `NO_GO`.
  - Every reference oracle is calibrated before its task's agent outcomes may be used as quality evidence. A calibration failure is a hard admission failure, not a retryable agent result.
  - No result-dependent advice, candidate or threshold changes are introduced to bypass a failed admission gate. A later experiment must separately freeze its confirmed SEKB candidate.
  - Actual provider usage, tools, timestamps, failures, edits and independent oracle reports are persisted and replayable. A hard acceptance failure may stop the campaign, with unexecuted slots retained explicitly.
  - Real-provider identity is an endpoint-reported alias, not a claim about the underlying model weights. Component-level evidence cannot authorize defaults, product promotion or release.
docs:
  required: false
  note: The operator and measurement boundaries are recorded here and in the curated result.
readmeUpdates: not-required
---

# Live acceptance boundaries

On 2026-11-04 the owner changed the prior offline-only scope to real acceptance,
provided the local Responses resource, and explicitly authorized uncapped usage.
No further budget question is needed. The evaluator still freezes a finite
experiment: 24 tasks, 3 arms, k=3, no silent retries, bounded output/requests and
time per trial. A task admission or safety failure is a valid NO-GO result.

Preparation distinguishes current evaluator policy from historical task inputs.
Reference commits and base commits come from original repository evidence;
oracle files must remain hidden and pinned. If the current oracle cannot grade
its historical reference, report the exact calibration mismatch and do not
convert that mismatch into evidence of model or RSI quality.

A task-ready package is still NO_GO until a passing provider preflight exists. The 2026-11-05 full cohort readback is `harness/specs/fixtures/rsi-live-acceptance/full-cohort-20261105-v3/`: 24 calibrated, 6 admitted, 18 rejected and 216 slots not-run. Independent test execution uses
a fresh local workspace and sanitized environment; it is not an OS-level sandbox
or packaged desktop acceptance. A NO_GO is a completed admission decision, not a
completed RSI benefit measurement. Subject execution and confirmed candidate
selection remain unexecuted when the current task cohort is rejected.
