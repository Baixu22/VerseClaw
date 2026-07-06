# Phase 5 Evidence Verifier Code Task Gate Shadow Evidence Quality Hardening

Status: continue_internal_shadow_observation_hardening
Date: 2026-07-02

This handoff records the first concrete shadow-evidence investment after limited default-off readiness entry tightening. It adds a pure runtime-core quality report helper and focused unit coverage. It does not implement an active code-task gate, add completion authority, change TaskLoop or Mission terminal status, add product config, persist diagnostics, add UI, touch Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport, insert prompts or model messages, write checkpoint/lifecycle authority, or change retry/approval/repair/tool-policy behavior.

## Source Context

Read these files before continuing:

1. `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md`
2. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`
3. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
4. `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`
5. `tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts`
6. `runtime-research/agent-runtime-index.md` Evidence Verifier section

## Implemented

Added `buildCodeTaskEvidenceGateShadowEvidenceQualityReport(...)`.

The helper consumes only caller-supplied in-memory reports:

- `CodeTaskEvidenceGateEvaluationReport`
- `CodeTaskEvidenceGateRuntimeReplayReadinessReport`
- `CodeTaskEvidenceGateInternalShadowObservationResult`

It returns a bounded quality report with:

- false-block cause coverage;
- risky false-allow coverage;
- runtime replay decision;
- internal observation decision;
- non-authority parity;
- one route decision: `ready_for_limited_default_off_readiness_review`, `continue_internal_shadow_observation_hardening`, or `stop_or_freeze_route`;
- authority fields fixed to `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, `legacyDecisionUnaffected: true`, and `activePilotRequiresFreshSpec: true`.

## Decision Semantics

| Input condition | Quality decision |
|---|---|
| Complete quality inputs, false-block causes covered, risky false-allow coverage sufficient, runtime replay ready, observation ready, and authority parity preserved | `ready_for_limited_default_off_readiness_review` |
| Missing evaluation, runtime replay, or observation input, incomplete false-block cause coverage, or insufficient risky false-allow coverage | `continue_internal_shadow_observation_hardening` |
| Runtime replay blocked, observation stop/freeze, or authority parity broken | `stop_or_freeze_route` |

The ready decision is readiness-review only. It does not approve active enforcement, default enablement, completion blocking, TaskLoop/Mission terminal-state changes, persistence, UI, product config, Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport changes, prompt/model-message insertion, checkpoint/lifecycle authority, retry/approval/repair/tool-policy changes, or completion proof from diagnostics.

## Tests Added

Focused tests now cover:

- closed quality taxonomy;
- ready quality report path;
- incomplete evidence quality routing to continued hardening;
- blocked replay/observation routing to stop/freeze;
- fixed non-authority fields on quality output.

## Docs Sync

Root README translations do not require updates because this is an internal runtime-core helper and research/harness route. It does not change product behavior, user-visible UI, public API, runtime configuration, release-facing behavior, or user workflows.

## Validation Results

`rtk` was unavailable in this worktree (`rtk --version` failed with command not found), so the required validation was run directly.

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md`
  - Result: passed; context selected gateway/backend communication boundary rules, docs sync, harness, and openclaw-runtime layers.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md --no-diff`
  - Result: passed; spec is structurally valid.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts`
  - Result: passed; 1 file / 42 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: passed; 5 files / 124 tests.
- `git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md`
  - Result: passed; only warning was that Git may replace LF with CRLF the next time it touches `runtime-research/agent-runtime-index.md`.
- `rg -n "[ \t]+$" ...`
  - Result: no trailing whitespace hits on the new/edited route files.
- forbidden active-authority, transport, and persistence/service/command scans on touched route files
  - Result: passed with classified documentation/historical/type-name hits only; see Boundary Classification.

`pnpm run comms:replay` and `pnpm run comms:compare` are not required unless a later edit touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Classification

- Active-authority scan hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only. No true completion-authority field, default enablement, reviewer prompt insertion, model-message insertion, active enforcement approval, or completion-authority implementation hit was found in the runtime helper or tests.
- Transport scan hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only. No Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, localhost transport, or provider transport implementation was added.
- Persistence/service/command scan hits are hard-boundary documentation, required validation command text, existing runtime index historical entries, and inherited in-memory `collectorId` type/test fixture names from the shadow collection contract. No file read/write, transcript/log read, DB/cache persistence, service/listener/daemon/sidecar/exporter behavior, command execution, or workspace sampling implementation was added.
- README translations were reviewed by scope. `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` do not require updates because this slice changes only internal runtime-core research helpers, harness specs, tests, and handoff/index documentation; it does not change user-visible behavior, UI, public API, runtime configuration, release-facing behavior, or user workflows.

## Next Step

Continue shadow evidence hardening through bounded caller-supplied in-memory fixtures, stricter quality-report thresholds, and scan classification only. Active enforcement remains blocked until a separate fresh spec is accepted with stronger runtime shadow evidence and explicit low-risk enforcement boundaries.
