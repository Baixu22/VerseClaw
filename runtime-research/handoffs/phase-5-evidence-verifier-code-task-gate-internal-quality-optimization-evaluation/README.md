# Phase 5 Evidence Verifier Code Task Gate Internal Quality Optimization Evaluation

Status: ready_for_limited_default_off_readiness_review
Date: 2026-07-02

This handoff records the internal optimization and quantitative evaluation slice for the Evidence Verifier code-task gate shadow route. It adds a pure runtime-core optimization scorecard helper and focused unit coverage. It does not implement an active code-task gate, add completion authority, change TaskLoop or Mission terminal status, add product config, persist diagnostics, add UI, touch Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport, insert prompts or model messages, write checkpoint/lifecycle authority, or change retry/approval/repair/tool-policy behavior.

## Source Context

Read these files before continuing:

1. `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md`
2. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening/README.md`
3. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`
4. `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`
5. `tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts`
6. `runtime-research/agent-runtime-index.md` Evidence Verifier section

## Implemented

Added `buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport(...)`.

The helper consumes only caller-supplied in-memory reports and optional summaries:

- `CodeTaskEvidenceGateEvaluationReport`
- `CodeTaskEvidenceGateRuntimeReplayReadinessReport`
- `CodeTaskEvidenceGateInternalShadowObservationResult`
- optional synthetic/sanitized fixture-matrix summary counts

It returns a bounded optimization scorecard with:

- the underlying shadow evidence quality decision;
- false-block cause coverage and risky false-allow coverage;
- category counts and required fixture-matrix coverage;
- false-block cause counts and risky false-allow semantic-signal counts;
- runtime replay and internal observation decision distributions;
- bounded stop/freeze reasons;
- a bounded `capabilityAssessment` with threshold snapshots, metric margins, category coverage, shortfall codes, and remediation targets;
- fixed non-authority fields: `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, `legacyDecisionUnaffected: true`, and `activePilotRequiresFreshSpec: true`;
- explicit diagnostic-only fields: `diagnosticOnly: true`, `callerOwnedInMemoryOnly: true`, and `taskCompletionEvidence: false`.

## Quantitative Matrix

The in-memory measurement matrix covers these synthetic/sanitized categories:

- valid full evidence
- missing verifier report
- missing test/tool evidence
- external validation not represented
- local test not required
- report shape/task id drift
- semantic regression with complete refs
- reviewer inconclusive
- non-code task
- legacy non-complete terminal status
- runtime replay ready / continue / blocked
- internal observation ready / hardening / stop-freeze
- authority drift sentinel cases

The optimization report quantifies:

- sample count and evaluated candidate count;
- block precision and recall;
- false-block rate and false-allow rate;
- risky false-allow share;
- false-block cause coverage;
- fixture category coverage;
- false-block cause counts and risky false-allow semantic risk sources;
- capability pass/fail, threshold margins, shortfall codes, and remediation targets;
- runtime replay and internal observation decision distributions;
- stop/freeze reasons.

The optimization decision now treats conservative runtime replay thresholds as hardening gates for internal measurement: sample count below `20`, evaluated candidate count below `16`, missing block precision / false-block rate / false-allow rate, block precision below `0.8`, false-block rate above `0.2`, or false-allow rate above `0.25` keeps the route in `continue_internal_shadow_observation_hardening`, even when the fixture matrix covers every required category.

The optimized capability matrix now has `52` synthetic/sanitized samples and `49` evaluated candidates, with block precision `20/23`, block recall `20/21`, false-block rate `3/23`, false-allow rate `1/26`, risky false-allow share `1`, false-block cause coverage `1`, full required category coverage, and preserved non-authority parity. Its capability assessment passes readiness-review thresholds with positive margins while remaining diagnostic-only.

## Decision Semantics

| Input condition | Optimization decision |
|---|---|
| Complete quality inputs, full required fixture-matrix coverage, false-block causes covered, risky false-allow coverage sufficient, runtime replay ready, observation ready, and authority parity preserved | `ready_for_limited_default_off_readiness_review` |
| Missing evaluation, runtime replay, or observation input; sample count below threshold; evaluated candidate count below threshold; missing precision/rate metrics; incomplete fixture-matrix coverage; incomplete false-block cause coverage; insufficient risky false-allow coverage; low block precision; high false-block rate; or high false-allow rate | `continue_internal_shadow_observation_hardening` |
| Runtime replay blocked, observation stop/freeze, authority parity broken, or explicit stop/freeze sentinel | `stop_or_freeze_route` |

The ready decision is readiness-review only. It does not approve active enforcement, default enablement, completion blocking, TaskLoop/Mission terminal-state changes, persistence, UI, product config, Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport changes, prompt/model-message insertion, checkpoint/lifecycle authority, retry/approval/repair/tool-policy changes, or completion proof from diagnostics.

## Tests Added

Focused tests now cover:

- closed optimization taxonomy;
- complete synthetic/sanitized matrix quantification;
- optimized capability matrix reaching readiness-review output without active authority;
- complete but weak quantitative matrix routing to continued hardening;
- high-scoring but undersized quantitative matrix routing to continued hardening;
- missing optimization metrics routing to continued hardening;
- incomplete fixture matrix routing to continued hardening;
- authority drift routing to stop/freeze;
- capability assessment remaining diagnostic-only and not task-completion evidence.

## Docs Sync

Root README translations do not require updates because this is an internal runtime-core helper and research/harness route. It does not change product behavior, user-visible UI, public API, runtime configuration, release-facing behavior, or user workflows.

## Validation Results

`rtk` was unavailable in this worktree (`Get-Command rtk` returned no command), so the required validation was run directly.

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md`
  - Result: passed; context selected gateway/backend communication boundary rules, docs sync, harness, and openclaw-runtime layers.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md --no-diff`
  - Result: passed; spec is structurally valid.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts`
  - Result: passed; 1 file / 48 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: passed; 2 files / 113 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: passed; 5 files / 130 tests.
- `git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation.md openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/task-loop-controller.test.ts runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-quality-optimization-evaluation/README.md runtime-research/agent-runtime-index.md`
  - Result: passed; only warning was that Git may replace LF with CRLF the next time it touches `runtime-research/agent-runtime-index.md`.
- `rg -n "[ \t]+$" ...`
  - Result: no trailing whitespace hits on the new/edited route files.
- active-pilot-readiness-string scan on touched route files
  - Result: no hits.
- forbidden active-authority, transport, and persistence/service/command scans on touched route files
  - Result: passed with classified documentation/historical/type-name hits only; see Boundary Classification.

`pnpm run comms:replay` and `pnpm run comms:compare` are not required unless a later edit touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Classification

- Active-authority scan hits are hard-boundary documentation and existing runtime index historical entries only. No true completion-authority field, default enablement, reviewer prompt insertion, model-message insertion, active enforcement approval, or completion-authority implementation hit was found in the runtime helper or tests.
- Active-pilot-readiness-string scan returned no hits on touched route files.
- Transport scan hits are hard-boundary documentation and existing runtime index historical entries only. No Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, localhost transport, or provider transport implementation was added.
- Persistence/service/command scan hits are hard-boundary documentation, required validation command text, existing runtime index historical entries, and inherited in-memory `collectorId` type/test fixture names from the shadow collection contract. No file read/write, transcript/log read, DB/cache persistence, service/listener/daemon/sidecar/exporter behavior, command execution, or workspace sampling implementation was added.
- README translations were reviewed by scope. `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` do not require updates because this slice changes only internal runtime-core research helpers, harness specs, tests, and handoff/index documentation; it does not change user-visible behavior, UI, public API, runtime configuration, release-facing behavior, or user workflows.

## Current Evaluation

Current optimized capability result is `ready_for_limited_default_off_readiness_review`. The weak complete-matrix sentinel still quantifies block precision `0.5`, false-block rate `0.5`, and false-allow rate `0.5`; those values are below/above the conservative thresholds and correctly keep that matrix in hardening. A high-scoring but undersized matrix also hardens on sample count, and missing optimization metrics harden fail-closed. The passing optimized matrix has `52` samples, `49` evaluated candidates, block precision `20/23`, block recall `20/21`, false-block rate `3/23`, false-allow rate `1/26`, full category coverage, full false-block cause coverage, risky false-allow share `1`, and non-authority parity. This output remains diagnostic-only and is not an active pilot.
