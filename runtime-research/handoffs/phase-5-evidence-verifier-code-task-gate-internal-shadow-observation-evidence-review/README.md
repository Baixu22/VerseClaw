# Phase 5 Evidence Verifier Code Task Gate Internal Shadow Observation Evidence Review

Status: superseded_by_limited_default_off_readiness_spec
Date: 2026-07-01

This handoff records the evidence-review package after limited default-off internal shadow observation. It is docs/spec-only. It does not implement an active code-task gate, add completion authority, change TaskLoop or Mission terminal status, add product config, persist diagnostics, add UI, touch Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport, insert prompts or model messages, write checkpoint/lifecycle authority, or change retry/approval/repair/tool-policy behavior. The next fresh readiness package is now recorded at `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`.

## Source Context

Read these files before continuing:

1. `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md`
2. `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
3. `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`
4. `tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts`
5. `tests/unit/task-loop-controller.test.ts`
6. `runtime-research/agent-runtime-index.md` Evidence Verifier section

## Phase Output

Files owned by this evidence-review package:

- `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md`
- `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md`
- `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
- `runtime-research/agent-runtime-index.md`

No new runtime helper is added in this phase. The previous phase already introduced `buildCodeTaskEvidenceGateInternalShadowObservationResult(...)`, which consumes only caller-owned in-memory `CodeTaskEvidenceGateRuntimeShadowCollectionResult` values and existing replay/readiness helpers. This phase reviews that bounded output and validation record only.

## Accepted Evidence Inputs

The review accepts only bounded internal observation results and validation records that prove:

- `nonAuthoritative: true`
- `completionAuthority: false`
- `runtimeDecisionUnaffected: true`
- `legacyDecisionUnaffected: true`
- `activePilotRequiresFreshSpec: true`
- observation mode is omitted/disabled by default or explicitly `shadow_only`
- accepted collections are caller-supplied in-memory results
- replay/readiness input is derived only from accepted in-memory collection entries
- checkpoint and lifecycle payloads do not contain the collection marker
- builder and sink failures do not alter TaskLoop completion

The review must not consume raw transcripts, raw logs, raw workspace scans, raw model prompts/messages, provider transport, Gateway/Main/renderer data, DB handles, files, sidecars, secrets, auth material, tool args/output, or replayed side effects.

## Evidence Classes

The minimum evidence set is:

| Evidence class | Source | Purpose |
|---|---|---|
| Fresh spec and context | `phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md` plus harness context | Proves implementation started from an explicit bounded spec. |
| Default-off no-op | focused TaskLoop and helper tests | Proves omitted/disabled mode does not call builder, sink, producer, caller, sampler, or observation. |
| Valid completion sample | focused TaskLoop sink accumulation test | Proves a valid completion can be observed without changing completion. |
| Missing evidence / would_block sample | focused TaskLoop sink accumulation test | Proves missing validation is diagnostic-only and not completion authority. |
| Semantic risk / risky_allow sample | focused TaskLoop sink accumulation test | Proves semantic-risk labeling stays diagnostic-only. |
| Invalid explicit input | helper and TaskLoop tests | Proves explicit invalid input fails closed without changing TaskLoop terminal result. |
| Failure isolation | builder/sink exception test | Proves collection failures do not affect TaskLoop completion. |
| Boundary scans | validation commands | Proves no new transport, persistence, prompt, service, command-execution, or active-authority surface was added. |
| Docs/index update | handoff README and runtime index | Proves the phase is documented as default-off, in-memory, diagnostic-only, and non-authoritative. |

## Decision Matrix

The evidence-review decision may be only one of:

- `blocked_before_internal_shadow_observation_review`
- `continue_internal_shadow_observation_hardening`
- `ready_for_limited_default_off_readiness_spec`

| Evidence condition | Decision |
|---|---|
| Fresh spec, context, tests, docs, and scans are missing or invalid | `blocked_before_internal_shadow_observation_review` |
| Any output grants completion authority, changes runtime decision, changes legacy decision, or omits active-pilot fresh-spec requirement | `blocked_before_internal_shadow_observation_review` |
| Any runtime helper reads files, logs, transcripts, workspace, configuration, global state, DB handles, Gateway/Main/renderer/provider transport, prompts, or model messages | `blocked_before_internal_shadow_observation_review` |
| Any UI, product config, persistence, service/listener/daemon, transport, checkpoint/lifecycle authority, prompt/model-message insertion, or default-on behavior is added | `blocked_before_internal_shadow_observation_review` |
| Required evidence exists but validation or boundary scan classification is incomplete | `continue_internal_shadow_observation_hardening` |
| Evidence covers the minimum set, validation passes, scans are classified, and all authority fields remain non-authoritative | `ready_for_limited_default_off_readiness_spec` |

## Phase Decision

Decision: `ready_for_limited_default_off_readiness_spec`.

This decision allows only a later fresh readiness-spec package. It does not approve active pilot, default enablement, runtime cutover, completion blocking, TaskLoop/Mission terminal-state changes, Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport changes, persistence, UI, product config, prompt/model-message insertion, checkpoint/lifecycle authority, retry/approval/repair/tool-policy changes, or completion proof from diagnostics.

## Rollback

Rollback remains trivial:

1. Reject this evidence-review package or any later readiness-spec entrance.
2. Stop consuming internal observation summaries for review.
3. Stop supplying explicit `shadow_only` mode or the injected in-memory sink.
4. Default TaskLoop behavior remains unchanged.

No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, checkpoint rollback, lifecycle rollback, or TaskLoop behavior rollback is required.

## Docs Sync

Root README translations were reviewed for this phase. No `README.md`, `README.zh-CN.md`, or `README.ja-JP.md` update is required because this phase changes only internal harness specs and research handoff documentation. It does not change product behavior, user-visible UI, public API, runtime configuration, release-facing behavior, or user workflows.

## Validation Results

Passed:

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-internal-shadow-observation.md --no-diff`
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md --no-diff`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: 2 files passed, 103 tests passed.
- `git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md`
  - Result: passed for tracked touched files.
- `rg -n "[ \t]+$" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-internal-shadow-observation-evidence-review/README.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md`
  - Result: no trailing-whitespace matches for new/untracked docs.

`pnpm run comms:replay` and `pnpm run comms:compare` are not required unless a later edit touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Classification

Boundary scans from the fresh spec were run.

- Active-authority scan hits are hard-boundary documentation, required scan command text, and historical index text only. No runtime helper/wiring code was changed in this phase.
- Transport scan hits are hard-boundary documentation, required scan command text, and existing runtime index historical entries only. No Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, or provider transport surface was added.
- Persistence/service/command scan hits are hard-boundary documentation, required validation command text, and existing runtime index historical entries only. No persistence, DB/cache, service/listener/daemon, sidecar/exporter/collector, command execution, transcript/log read, or workspace scan behavior was added.

Any future code hit in runtime helper/wiring files for transport, persistence, service/listener, prompt/model-message insertion, command execution, active authority, or completion authority must block the phase.

## Next Step

The next fresh package is `harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec.md` with handoff `runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/README.md`.

The next allowed decision is readiness review of that limited default-off package, continued internal shadow observation hardening, or freezing the route. It still may not directly enter active pilot. Active pilot remains blocked until a separate fresh spec is accepted with stronger runtime shadow evidence and explicit low-risk enforcement boundaries.
