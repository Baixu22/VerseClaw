---
lifecycleStatus: active
id: rsi-benefit-eval
title: Freeze and replay a three-arm RSI benefit evaluation
intent: Add an offline-verifiable benefit evaluation pack and a bounded Responses adapter, using the existing RSI corpus and statistical policy while keeping simulated evidence distinct from measured benefit.
diffBase: 32236f492
touchedAreas:
  - scripts/rsi-benefit-eval.*
  - scripts/lib/rsi-benefit-eval.*
  - scripts/lib/rsi-responses-provider.*
  - tests/unit/rsi-benefit-eval.test.ts
  - tests/unit/rsi-responses-provider.test.ts
  - harness/specs/tasks/rsi-benefit-eval.md
  - harness/specs/fixtures/rsi-benefit-eval/**
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
  - paired-ablation-boundary
expectedUserBehavior:
  - A plan freezes the 24 existing task identities, three arms, k=3, order, provider identity, policy, candidate and evaluator inputs before results exist.
  - Offline execution exercises 216 declared slots and resume without network calls, while the benefit verdict remains insufficient-evidence.
  - An independent reader recomputes outcomes, paired intervals and all cost dimensions from retained receipts and rejects tampering or missing slots.
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-responses-provider.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/rsi-benefit-eval.md
  - git diff --check
acceptance:
  - Reuses the current 24 tasks, safety annotations and shared TF-0592 statistics; does not replace historical evidence or loosen the 20-case, k=3, 5pp and 10 percent criteria.
  - Off and shadow executor inputs are identical; confirmed input records the candidate context. Stochastic output differences are diagnostics, not proof of wiring drift.
  - Reports all cases, paired complete cases, public and held-out slices, passK/passAtK, uncertainty/power, tokens, tool calls, turns, latency and missing usage.
  - Interrupted trials are visible and are not silently retried; resume cannot mix plans, models, arms, evaluator revisions or repeated response identifiers.
  - Safety violations, incomplete required coverage, missing cost and changed bytes cannot produce a benefit claim.
  - Frozen evaluator/oracle metadata is excluded from executor requests; a candidate learning source overlapping evaluation tasks is rejected.
  - Responses adapter preserves incomplete/error states and actual usage; tests use only stub transports or local test servers, never the supplied real endpoint.
  - All offline outputs are explicitly agent-driven synthetic controls; product locks and promotionReady remain false.
docs:
  required: false
  note: This task includes the operator runbook below. Existing README diagnostic-only statements remain accurate.
readmeUpdates: not-required
---

# RSI benefit eval

Scope: the existing SEKB off/shadow/confirmed experience experiment. This does
not create a code self-modification loop. The owner selected **eval and offline
validation only** on 2026-11-04. The supplied local Responses endpoint and model
are configuration for the adapter; no live-provider call is authorized this run.

The old 180-slot plan was a minimum of 20 cases. This plan retains all 24 current
task identities, so it has **216 slots**. Public/held-out membership comes from
the existing historical corpus and is reported separately. Task prompts are
executor input; reference solutions, oracle definitions and grade results are
evaluator-only. Candidate experiences must be frozen independently and may not
be learned from these evaluation tasks.

The offline driver uses deterministic protocol controls, not answers to the
historical coding tasks. Its positive numeric control deliberately clears the
statistical gate; the enclosing benefit judgement must still refuse a live
benefit claim. No quality result is inferred from those synthetic outputs.

The Responses adapter is a reusable single-request transport. A production
coding executor and its independent final-state grader must supply genuine
receipts before a live measurement can be accepted; a response text or a claimed
pass is never equivalent to executing the historical task's oracle.

## Commands

```powershell
$env:TEMP = 'D:\tmp'; $env:TMP = 'D:\tmp'
node scripts/rsi-benefit-eval.mjs plan --run-dir D:/tmp/rsi-benefit-offline --model space-bunny --endpoint http://127.0.0.1:3065/v1/responses
node scripts/rsi-benefit-eval.mjs offline --run-dir D:/tmp/rsi-benefit-offline --limit 9
node scripts/rsi-benefit-eval.mjs offline --run-dir D:/tmp/rsi-benefit-offline
node scripts/rsi-benefit-eval.mjs check --run-dir D:/tmp/rsi-benefit-offline
```

`plan` requires a fresh directory. `offline` resumes untouched slots and never
calls the network. An interrupted start marker becomes a retained crash, not a
second attempt. `report` rederives results; `check` verifies the manifest, raw
receipts, saved report and coverage. Keep the entire run directory for replay.

A future measured plan uses `--mode measured --candidate-file <json>` plus
explicit `--max-provider-calls` and `--max-total-tokens`. Its candidate contains
`id`, `kind: confirmed-sekb`, `context` and independent `sourceCaseIds`. Creating
this plan does not call a provider. `record --receipt <json>` admits one immutable
collector receipt or an ordered array in one validation batch; the offline runner refuses measured plans. The runtime
executor must use `buildBenefitRequest`, retain provider attempts and real
oracle reports, and supply the exact slot/config identity. The provider adapter
returns both parsed fields and `rawResponse` for that collector. Read credentials
from an environment variable in the caller, never a plan or checked-in file.

The measured reader validates the receipt contract and derives outcomes from
oracle assertions; it cannot independently attest that an arbitrary imported
JSON was executed by a trusted collector. Its `benefit` is cohort-scoped and
`promotionReady` remains false. Production execution, network containment and
an independent candidate review remain required before product claims. The
current deliverable includes a tested collector interface, not a new desktop
coding agent or a claim that the historical 24 tasks were executed this turn.

For stochastic providers, off/shadow **requests and configuration effects** must
match. Unequal sampled answers alone do not prove a wiring defect. The report
keeps the shadow effect and confidence interval visible and separately applies
safety and stability gates.

## Collector receipt

`BenefitTrialReceipt` in `scripts/lib/rsi-benefit-eval.d.mts` defines the full
shape. `slot`, `planDigest`, `requestDigest`, runtime flags and candidate context
must match the frozen plan. `providerAttempts` retain the complete request,
`rawResponse` and `parsedResponse`; the latter is rederived on admission. The
terminal `rawResponse` and grader's `responseDigest` refer to the same content.
Tool continuations append exactly the previous response output and matching
tool results to the existing input. Extra hidden prompt items are rejected.

`execution.runPosition`, `startedAt` and `endedAt` record actual collector order;
out-of-order batches and overlapping timestamps are rejected. Interrupted slots
stay visible. Grader reports carry their exact command, required test paths and
assertion results; inconsistent counts, skipped/todo tests and self-grading are
rejected. The optional dollar cost stays null if the provider does not report
it; the frozen token/tool-call ceilings remain required. Budget limits in this
reader reject over-budget evidence; the future executor must enforce them
before dispatching paid requests.
