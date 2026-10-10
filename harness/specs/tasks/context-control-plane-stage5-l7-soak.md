---
lifecycleStatus: archived
id: context-control-plane-stage5-l7-soak
title: Context Control Plane Stage 5 L7 Post-Stage6 Soak Acceptance
taskType: runtime-authority-convergence
intent: >-
  Close the deferred Stage 5 L7 soak with owner-approved quantitative
  thresholds. Ten paired real DeepSeek coding turns (baseline Stage 2 chain
  vs experiment Stage 5 observation/packer/facade) produce digest/ref/metric-only
  evidence and prove critical/constraint/evidence retention, compile latency,
  token budget, and real-sample pairing requirements.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage5-l7-soak.md
  - docs/dev/context-control-plane/DEVLOG.zh-CN.md
  - docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md
  - openclaw_runtime/src/agents/stage2-golden-run.ts
  - openclaw_runtime/src/agents/stage5-golden-run.ts
  - openclaw_runtime/src/agents/stage5-l7-soak.ts
  - openclaw_runtime/src/agents/stage5-l7-soak.test.ts
  - artifacts/context-control-plane/stage5-l7-soak-evidence.json
ownerDecisions:
  - "S1 accepted: critical retention target is 100% over effective experiment turns. Any critical-over-window turn is invalid and is not counted as retained."
  - "S2 accepted: constraint retention target is 100% over effective experiment turns. Atomic constraint units may never be prefix-sliced or silently dropped."
  - "S3 accepted: evidence retention target is 100% over effective experiment turns. Digest/ref evidence must survive packing in every effective turn."
  - "S4 accepted: P95 total pre+post DCS compile latency target is <=100 ms measured on Windows x64, warm Node 24 process, over all paired real turns."
  - "S5 accepted: P95 total input+output tokens per real turn target is <=4000 tokens. Monetary cost target is <=0.02 USD/turn when the provider returns a price; otherwise the token budget is the enforceable gate."
  - "S6 accepted: minimum 10 valid paired samples (10 baseline + 10 experiment, 20 real provider turns total). Each pair uses the same prompt shape and adjacent execution; missing effect receipt, envelope digest, journal ref, or timings invalidates a sample."
blockedBy: []
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
  - context-family-boundary
  - active-config-guards
humanEvidence: not-required
forbiddenPatterns:
  - inventing retention/latency/cost thresholds not listed in ownerDecisions
  - promoting synthetic, cached, fixture, or agent-surrogate runs to soak samples
  - persisting key, prompt text, tool arguments, tool output, or credentials in soak evidence
  - changing stage5 facade/packer behavior, product defaults, or product locks
  - adding a durable writer, receipt store, provider, or second authority
  - committing, pushing, or creating a PR
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage5-memory-facade.test.ts src/context-engine/stage5-unit-aware-packer.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/context-control-plane-stage5-contracts.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-golden-run.test.ts src/agents/stage5-l7-soak.test.ts --reporter=verbose
  - DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-l7-soak.test.ts --reporter=dot --test-timeout=600000
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - git diff --check
acceptance:
  - "L1: S1-S6 are frozen in ownerDecisions; missing values must remain blockedBy and stop the slice."
  - "L2: every soak sample is a real provider turn with a real write tool effect and EffectReceipt; synthetic/cached sample count is zero."
  - "L3: critical, constraint, and evidence retention over effective experiment turns are 100%; any overflow invalidates the turn and is queryable."
  - "L4: P95 total compile latency <=100 ms and P95 turn tokens <=4000; monetary cost gate applies only when provider price is available."
  - "L5: stage5-l7-soak-evidence.json contains only schema/model/runId/digest/ref/id/metrics; no key, prompt, tool arguments, tool output, or credentials."
  - "L6: soak runner real path is default off and runIf-skipped without key; no production byte/tool-set/default behavior change."
  - "L7: metric projection is pure: equal input deep-equal, no wall-clock/random inside the projection, invalid/duplicate samples fail closed."
  - "L8: all required gates pass; product locks remain false; DEEPSEEK_API_KEY absent from all persistent scopes; sk-hex32 scan zero; no commit/push/PR."
docs:
  required: true
  files:
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - harness/specs/tasks/context-control-plane-stage5.md
    - artifacts/context-control-plane/stage5-real-run-evidence.json
---

# Context Control Plane Stage 5 L7 Soak

Stage 5 L7 closes the deferred soak observation with the owner-approved
S1-S6 baseline recorded in frontmatter. The runner is default off and only
executes real DeepSeek turns when `DEEPSEEK_API_KEY` is visible. Every sample
is a real provider -> write tool -> grant/Tool Guard/EffectReceipt turn; no
synthetic or cached run is promoted.

## 1. Baseline standard

- critical/constraint/evidence retention: 100% over effective experiment turns.
- P95 total pre+post DCS compile latency: <= 100 ms.
- P95 input+output tokens per turn: <= 4,000 tokens.
- Monetary cost: <= 0.02 USD/turn when provider price is available.
- Samples: 10 paired blocks, each one baseline (Stage 2 chain) and one
  experiment (Stage 5 observation), for 20 real provider turns total.

## 2. Implementation

- `stage5-l7-soak.ts` owns the pure metric projection and pass/fail evaluation.
- `stage5-l7-soak.test.ts` owns the default-off real soak runner
  (`it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))`) and writes
  `artifacts/context-control-plane/stage5-l7-soak-evidence.json`.
- `stage2-golden-run.ts` exposes optional `collectTimings` metrics without
  changing request bytes, tool execution, or decisions.
- `stage5-golden-run.ts` propagates those timings in its success result.

## 3. Evidence

- `artifacts/context-control-plane/stage5-l7-soak-evidence.json` is
  digest/ref/metric-only. It never contains API keys, prompt text, tool
  arguments, tool output, credentials, or environment values.
- Product locks `defaultOn=false`, `liveReady=false`, and
  `productApproved=false` remain unchanged.
