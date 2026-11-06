---
lifecycleStatus: active
id: rsi-coding-full-completion
title: Complete all remaining RSI coding measurements and evidence closure
intent: Finish TF-0809 with a clean dependency environment, a preregistered bounded structured-output collector, all 216 real provider trials and an independently recomputable final decision, including negative results.
diffBase: 0494e19c70af2ef1e0beaa0bdb11c2dac871a271
touchedAreas:
  - scripts/duplicate-assets-allowlist.json
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - scripts/rsi-*.mjs
  - scripts/rsi-*.mts
  - scripts/rsi-*.d.mts
  - scripts/lib/rsi-*.mjs
  - scripts/lib/rsi-*.d.mts
  - tests/unit/rsi-*.test.ts
  - harness/specs/tasks/rsi-*.md
  - harness/specs/fixtures/rsi-coding-cohort/**
  - harness/specs/fixtures/rsi-benefit-eval/coding-complete-20261106-v2/**
  - harness/specs/fixtures/rsi-live-acceptance/complete-cohort-20261106-v8/**
  - harness/specs/fixtures/rsi-live-acceptance/.gitattributes
  - docs/dev/rsi-capability-and-boundaries.md
  - docs/generated/catalogs/prod-flags.md
  - docs/generated/catalogs/tools.md
requiredProfiles:
  - rsi
requiredRules:
  - disk-temp-policy
  - paired-ablation-boundary
  - reliability-aggregation-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - A failed historical batch remains immutable while the agent completes the remaining authorized work.
  - A new protocol is frozen before collecting any of its evaluation outcomes.
  - Complete collection and a negative benefit decision are separate facts.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/rsi-coding-collector.test.ts tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-responses-provider.test.ts tests/unit/rsi-live-grader.test.ts tests/unit/rsi-live-acceptance.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/rsi-coding-full-completion.md
  - git diff --check
acceptance:
  - A fresh isolated checkout installs frozen root and runtime dependencies without modifying the shared node_modules or unrelated edits; full node, web and test TypeScript gates pass.
  - All 24 reference and unresolved-baseline oracles are executed with exact support dependencies; original reference revisions, test bytes, task identities and reconstructed-start labels remain bound.
  - The independently trained SEKB candidate remains unchanged, and no evaluation response trains the candidate or supplies task-specific advice.
  - RsiCodingCollector/v2 freezes native strict JSON schema, low reasoning, 16000 output tokens, request timeout, order, one provider attempt per slot, endpoint, alias and whole-run budgets before the first task dispatch.
  - All 216 slots retain actual dispatch and terminal receipts, raw response and actual usage when available, explicit failure/unknown fields otherwise, and source identities; successful edits are independently graded and zero hidden retries occur.
  - An observed incomplete/max_output_tokens response with known usage is an unsuccessful model answer in v2, never a pass or fabricated grade; missing terminal receipts, unknown usage, timeout and crashes remain explicit incomplete evidence.
  - The original v1 batch and its missing/incomplete interpretation remain unchanged and replayable at its frozen source revision.
  - V2 continues other scheduled slots after a retained provider/infrastructure failure while reserving the full input-byte plus output-token bound for unknown usage. The reservation is not reported as measured usage. Oracle drift or a changed evaluator still fails closed.
  - The independent report recomputes all outcomes, case-cluster statistics, cost and safety gates. A non-promoting or negative result closes the experiment without claiming RSI benefit or changing product defaults or locks.
  - All maintained RSI readbacks and negative controls pass at their intended source boundary, reports have complete hashes and zero credential hits, and the evidence-complete Task Forest proposal is applied, validated and exported.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# Frozen continuation protocol

The owner explicitly requires finishing every remaining RSI task, not merely
sealing a failed partial batch. This spec continues TF-0809 and does not reopen
the frozen code-self-modification or product-default decisions.

The v1 batch at `rsi-benefit-eval/coding-20261106/measurement/` remains immutable: a
known terminal output-limit response was interpreted as missing, and the campaign
stopped with an additional unknown dispatch. No v1 slot is retried or overwritten.

V2 is a new experiment with an explicit response schema in the transport request.
The local resource may not enforce that native schema hint; JSON edits are always
strictly validated locally, and invalid output remains a recorded model failure.
Explicit loopback HTTP uses a direct Node HTTP agent rather than an inherited
system fetch proxy. It retains the same timeout, redirect refusal and body limit.
An output-limit response whose terminal status, reason and usage are retained is
an observed unsuccessful attempt; it contributes failure, not success, to case
aggregation. No partial code is applied or graded. Unknown responses and usage
still cannot become failures or passes by assumption. The 5pp effect floor, 95%
interval, 10% cost ceiling, k=3, task splits and safety anchors do not change.

Independent protocol probes use two newly authored escaping and array-copy tasks,
not hidden tests or reference implementations from the evaluation cohort. Neither
their output nor evaluation feedback changes the previously frozen SEKB candidate.

The run remains source-harness evidence, not packaged desktop or OS sandbox
acceptance. Endpoint model identity is an alias. Explicit agent actors and actual
command exits are retained; no human identity or positive benefit is fabricated.

Current maintenance snapshots live under `rsi-coding-cohort/instruments/`. The
original decision acceptance, TF-0590 corpus and TF-0592 reservation remain byte
identical. New snapshots revalidate source and registry bindings and replay the
existing labelled grader/control inputs; they do not claim new model calibration
or historical task execution. The live measurement continues to use the original
frozen cohort plus explicit reconstruction bindings and reference-revision tests.

The existing duplicate-asset registry records the exact calibration mirrors needed
by the independently readable admission and measurement packs. Registration keeps
their original bytes and hash manifests unchanged.

Generated flag and tool catalogues are refreshed with the existing catalogue
generator so the full CI baseline describes the current source. Product defaults
and tool policies are unchanged.
